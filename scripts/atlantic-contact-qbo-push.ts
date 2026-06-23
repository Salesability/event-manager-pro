// Chunk 0091 Phase 3 — push the refreshed primary contact (the GM) of each of the
// 86 skip-existing dealers to its linked QuickBooks Customer (GivenName/FamilyName/
// PrimaryEmailAddr/PrimaryPhone), mirroring mapDealerToCustomer + pushDealerToQuickbooks.
// The app's QBO modules are `server-only` so the HTTP + token-decrypt are replicated
// here (same as the 0086 import inlined its DB logic). Best-effort per dealer.
//
// SAFETY: dry-run by default — GETs each Customer and prints current→new for the
// ones that DIFFER, no writes. `--write` performs the sparse update on those.
//
// Run (dry-run):  ./scripts/with-prod-db.sh pnpm dlx tsx scripts/atlantic-contact-qbo-push.ts
// Run (COMMIT):   ./scripts/with-prod-db.sh pnpm dlx tsx scripts/atlantic-contact-qbo-push.ts --write

import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

const WRITE = process.argv.includes('--write');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('Missing DATABASE_URL (run via with-prod-db.sh).'); process.exit(1); }
if (!process.env.QBO_TOKEN_ENC_KEY) { console.error('Missing QBO_TOKEN_ENC_KEY (stash it in .env.prod.local).'); process.exit(1); }

const API_BASE = 'https://quickbooks.api.intuit.com'; // production
const MINOR_VERSION = '75';
const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Replicates sealed-box.ts decrypt: v1.<base64(iv[12] | tag[16] | ciphertext)>, AES-256-GCM.
function decryptToken(payload: string): string {
  const key = Buffer.from((process.env.QBO_TOKEN_ENC_KEY ?? '').trim(), 'base64');
  const dot = payload.indexOf('.');
  if (payload.slice(0, dot) !== 'v1') throw new Error('bad token ciphertext version');
  const buf = Buffer.from(payload.slice(dot + 1), 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function parseCsv(t: string): string[][] {
  const R: string[][] = []; let r: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); R.push(r); r = []; f = ''; } else if (c !== '\r') f += c; }
  if (f.length || r.length) { r.push(f); R.push(r); } return R;
}

type Dealer = {
  id: number; name: string; address: string | null; province: string | null; phone: string | null;
  quickbooksId: string | null; contactFirstName: string | null; contactLastName: string | null;
  primaryEmail: string | null; primaryPhone: string | null;
};

// CONTACT-ONLY sparse payload (GivenName/FamilyName/PrimaryEmailAddr/PrimaryPhone).
// Unlike the app's mapDealerToCustomer we deliberately OMIT DisplayName/CompanyName
// — this is a contact refresh, and re-sending the name trips QBO's duplicate-name
// (6240) check on the duplicate-dealer rooftops (Sydney Mazda / Parkway Hyundai).
function contactPayload(d: Dealer): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (d.contactFirstName) input.GivenName = d.contactFirstName;
  if (d.contactLastName) input.FamilyName = d.contactLastName;
  if (d.primaryEmail) input.PrimaryEmailAddr = { Address: d.primaryEmail };
  const phone = d.phone ?? d.primaryPhone;
  if (phone) input.PrimaryPhone = { FreeFormNumber: phone };
  return input;
}

async function qboGet(realm: string, token: string, id: string): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}/v3/company/${realm}/customer/${encodeURIComponent(id)}?minorversion=${MINOR_VERSION}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET customer ${id}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { Customer: Record<string, any> }).Customer;
}
async function qboUpdate(realm: string, token: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/v3/company/${realm}/customer?minorversion=${MINOR_VERSION}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...payload, sparse: true }) });
  if (!res.ok) throw new Error(`POST customer ${payload.Id}: ${res.status} ${await res.text()}`);
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
  console.log(`\n=== 0091 Phase 3 — QBO contact push ${WRITE ? '(WRITING)' : '(DRY RUN — GET only)'} ===`);
  console.log(`api: ${API_BASE}  host: ${DATABASE_URL!.replace(/.*@([^/?]+).*/, '$1')}\n`);

  const [conn] = await sql<{ realm_id: string; access_token_enc: string; access_token_expires_at: string }[]>`
    select realm_id, access_token_enc, access_token_expires_at from quickbooks_connection order by id limit 1`;
  if (!conn) { console.error('No QBO connection on prod. Reconnect at /admin/quickbooks.'); await sql.end(); process.exit(1); }
  if (new Date(conn.access_token_expires_at).getTime() - Date.now() < 60_000) {
    console.error('Access token is at/near expiry. Load /admin/quickbooks (refreshes it) then re-run.'); await sql.end(); process.exit(1);
  }
  const token = decryptToken(conn.access_token_enc);
  const realm = conn.realm_id;
  console.log(`realm ${realm}, access token decrypted (expires ${conn.access_token_expires_at}).\n`);

  // the 86 skip-existing dealers
  const recon = parseCsv(readFileSync(new URL('./data/atlantic-reconciliation.csv', import.meta.url), 'utf8'));
  const rh = recon[0]; const rc = (n: string) => rh.indexOf(n);
  const skip = recon.slice(1).filter((r) => r[rc('bd_name')] && (r[rc('suggested_action')] || '').trim() === 'skip-existing');
  const wantNames = new Set(skip.map((r) => lower(r[rc('prod_match_name')] || r[rc('bd_name')])));

  // dealers + links to resolve the primary contact (lowest-linkId staff > customer > prospect).
  const rows = await sql<{ id: number; name: string; address: string | null; province: string | null; phone: string | null;
    quickbooks_id: string | null; link_id: number | null; role: string | null; cid: number | null; first_name: string | null; last_name: string | null }[]>`
    select d.id, d.name, d.address, d.province::text province, d.phone, d.quickbooks_id,
           dc.id link_id, dc.role::text role, c.id cid, c.first_name, c.last_name
    from dealers d
    left join dealer_contacts dc on dc.dealer_id=d.id and dc.archived_at is null
    left join contacts c on c.id=dc.contact_id and c.archived_at is null
    where d.archived_at is null`;

  const PRI: Record<string, number> = { staff: 0, customer: 1, prospect: 2 };
  const byDealer = new Map<number, { d: Dealer; best: { linkId: number; pri: number; cid: number; fn: string | null; ln: string | null } | null }>();
  for (const r of rows) {
    if (!wantNames.has(lower(r.name))) continue;
    let e = byDealer.get(r.id);
    if (!e) { e = { d: { id: r.id, name: r.name, address: r.address, province: r.province, phone: r.phone, quickbooksId: r.quickbooks_id, contactFirstName: null, contactLastName: null, primaryEmail: null, primaryPhone: null }, best: null }; byDealer.set(r.id, e); }
    if (r.link_id != null && r.cid != null && r.role) {
      const pri = PRI[r.role] ?? 9;
      const linkId = Number(r.link_id); // postgres returns bigint as a string — compare numerically
      if (!e.best || pri < e.best.pri || (pri === e.best.pri && linkId < e.best.linkId)) {
        e.best = { linkId, pri, cid: r.cid, fn: r.first_name, ln: r.last_name };
      }
    }
  }
  // primary email + phone for each resolved primary contact
  const primCids = [...byDealer.values()].map((e) => e.best?.cid).filter((x): x is number => x != null);
  const idents = primCids.length ? await sql<{ contact_id: number; kind: string; value: string }[]>`
    select contact_id, kind::text kind, value from contact_identifiers
    where is_primary and archived_at is null and contact_id in ${sql(primCids)}` : [];
  const emailOf = new Map<number, string>(), phoneOf = new Map<number, string>();
  for (const i of idents) { (i.kind === 'email' ? emailOf : phoneOf).set(i.contact_id, i.value); }
  for (const e of byDealer.values()) {
    if (e.best) { e.d.contactFirstName = e.best.fn; e.d.contactLastName = e.best.ln; e.d.primaryEmail = emailOf.get(e.best.cid) ?? null; e.d.primaryPhone = phoneOf.get(e.best.cid) ?? null; }
  }
  await sql.end();

  const stats = { total: byDealer.size, unlinked: 0, matched: 0, wouldChange: 0, pushed: 0, errors: 0 };
  for (const { d } of byDealer.values()) {
    if (!d.quickbooksId) { stats.unlinked++; console.log(`[unlinked] ${d.name} — no quickbooks_id, skipped`); continue; }
    try {
      const cur = await qboGet(realm, token, d.quickbooksId);
      const curEmail = cur.PrimaryEmailAddr?.Address ?? '';
      const newName = `${d.contactFirstName ?? ''} ${d.contactLastName ?? ''}`.trim();
      const curName = `${cur.GivenName ?? ''} ${cur.FamilyName ?? ''}`.trim();
      // Only a non-empty NEW value is a change — we never clear a field (sparse
      // update omits empty values), so empty-vs-set mustn't flag forever.
      const nameChanged = !!newName && lower(newName) !== lower(curName);
      const emailChanged = !!d.primaryEmail && lower(d.primaryEmail) !== lower(curEmail);
      if (!nameChanged && !emailChanged) { stats.matched++; continue; }
      stats.wouldChange++;
      console.log(`[CHANGE] ${d.name}: QBO "${curName}" <${curEmail || '∅'}>  →  "${newName}" <${d.primaryEmail || '∅'}>`);
      if (WRITE) {
        const fresh = await qboGet(realm, token, d.quickbooksId);
        await qboUpdate(realm, token, { ...contactPayload(d), Id: d.quickbooksId, SyncToken: fresh.SyncToken ?? '0' });
        stats.pushed++;
      }
      await sleep(60);
    } catch (e) {
      stats.errors++;
      console.log(`  ⚠ ${d.name}: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  console.log(`\n=== SUMMARY ${WRITE ? '(COMMITTED)' : '(DRY RUN)'} ===`);
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(12)}: ${v}`);
  if (!WRITE && stats.wouldChange) console.log(`\n→ ${stats.wouldChange} QBO Customers would be updated. Re-run with --write to push.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
