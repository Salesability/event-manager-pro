// Chunk 0091 — Atlantic dealer CONTACT REFRESH writer (un-parks 0086-c). Applies
// the BD tracker's authoritative GM + GSM/SM contacts to the 86 owner-vetted
// `skip-existing` prod dealers the 0086 insert-only import left untouched.
//
// Per dealer (Option A, decision.md D7): make the GM the PRIMARY by repointing the
// dealer's lowest-linkId active staff link to the GM contact (so the GM inherits
// the lowest id → wins the primary heuristic in queries.ts), re-link the displaced
// person as a secondary staff contact (D6 keep — never deletes), and link the SM
// (`title='Sales Manager'`). Reconciliation comes from the shared pure module
// (same as the preview); approvals come from the vetted preview CSV.
//
// SAFETY: every write runs inside ONE transaction; without --write the tx is
// ROLLED BACK at the end (so a dry-run exercises the real constraints + gives
// accurate counts, persisting nothing). Idempotent: a committed re-run is a no-op.
//
// Run (dry-run, default — sandbox):  set -a && source .env.local && set +a && pnpm dlx tsx scripts/atlantic-contact-refresh.ts
// Run (dry-run vs PROD):             ./scripts/with-prod-db.sh pnpm dlx tsx scripts/atlantic-contact-refresh.ts
// Run (COMMIT vs PROD):              ./scripts/with-prod-db.sh pnpm dlx tsx scripts/atlantic-contact-refresh.ts --write

import { readFileSync } from 'node:fs';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { contactIdentifiers, contacts, dealerContacts } from '../src/lib/db/schema';
import { type AtlanticFile, dropKey, mapRowToContacts, splitName } from '../src/features/dealers/atlantic-import';
import {
  type ExistingContact,
  type ReconciledContact,
  reconcileDealerContacts,
} from '../src/features/dealers/atlantic-contact-refresh';

const WRITE = process.argv.includes('--write');
const REFRESH_SOURCE = 'atlantic-contact-refresh-0091';
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL (source .env.local, or run via with-prod-db.sh).');
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

const client = postgres(DATABASE_URL, { prepare: false, max: 1 });
const db = drizzle(client, { schema });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class DryRunRollback extends Error {}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const stats = {
  dealers: 0, dealersTouched: 0, contactsCreated: 0, contactsReused: 0,
  namesUpdated: 0, emailsSwapped: 0, emailConflicts: 0,
  gmAlreadyPrimary: 0, primaryRepointed: 0, displacedRelinked: 0,
  smLinked: 0, edgeSkips: 0, notApproved: 0, noMatch: 0,
};

// --- contact/identifier helpers (mirror swapPrimaryIdentifier + the 0086 import) ---
async function findContactIdByEmail(tx: Tx, email: string): Promise<number | null> {
  const [r] = await tx.select({ id: contactIdentifiers.contactId }).from(contactIdentifiers)
    .where(and(eq(contactIdentifiers.kind, 'email'), eq(contactIdentifiers.value, email), isNull(contactIdentifiers.archivedAt)))
    .limit(1);
  return r?.id ?? null;
}
async function createContact(tx: Tx, firstName: string, lastName: string, email: string | null): Promise<number> {
  const [cr] = await tx.insert(contacts).values({ firstName, lastName }).returning({ id: contacts.id });
  if (email) {
    await tx.insert(contactIdentifiers).values({ contactId: cr.id, kind: 'email', value: email, isPrimary: true, source: REFRESH_SOURCE });
  }
  return cr.id;
}
async function updateContactName(tx: Tx, contactId: number, firstName: string, lastName: string): Promise<void> {
  await tx.update(contacts).set({ firstName, lastName }).where(eq(contacts.id, contactId));
}
// Mirrors swapPrimaryIdentifier (actions.ts): demote old primary, global-unique
// pre-check, insert new. Returns the outcome instead of throwing on conflict.
async function swapPrimaryEmail(tx: Tx, contactId: number, newEmail: string): Promise<'changed' | 'noop' | 'conflict'> {
  const [existing] = await tx.select({ id: contactIdentifiers.id, value: contactIdentifiers.value })
    .from(contactIdentifiers)
    .where(and(eq(contactIdentifiers.contactId, contactId), eq(contactIdentifiers.kind, 'email'), eq(contactIdentifiers.isPrimary, true), isNull(contactIdentifiers.archivedAt)))
    .limit(1);
  if (existing && existing.value === newEmail) return 'noop';
  const conflict = await tx.select({ contactId: contactIdentifiers.contactId }).from(contactIdentifiers)
    .where(and(eq(contactIdentifiers.kind, 'email'), eq(contactIdentifiers.value, newEmail), ne(contactIdentifiers.contactId, contactId), isNull(contactIdentifiers.archivedAt)))
    .limit(1);
  if (conflict.length > 0) return 'conflict';
  if (existing) {
    await tx.update(contactIdentifiers).set({ archivedAt: new Date(), isPrimary: false }).where(eq(contactIdentifiers.id, existing.id));
  }
  await tx.insert(contactIdentifiers).values({ contactId, kind: 'email', value: newEmail, isPrimary: true, source: REFRESH_SOURCE });
  return 'changed';
}
async function ensureStaffLink(tx: Tx, dealerId: number, contactId: number, title: string | null): Promise<void> {
  // One-time 0091 script (already run); the legacy dealer_contacts.role column was
  // dropped by 0089 Phase 4, so this dead helper no longer references it.
  await tx.insert(dealerContacts).values({ dealerId, contactId, title, source: REFRESH_SOURCE })
    .onConflictDoUpdate({ target: [dealerContacts.dealerId, dealerContacts.contactId], set: { title, archivedAt: null } });
}

// Resolve a BD slot to a contactId, applying its field updates. Caller has already
// gated approval for update/conflict.
async function resolveContact(tx: Tx, plan: ReconciledContact): Promise<number> {
  const { firstName, lastName } = splitName(plan.bdName);
  const email = plan.bdEmail || null;
  if (plan.disposition === 'add') {
    if (email) {
      const existing = await findContactIdByEmail(tx, email);
      if (existing != null) { stats.contactsReused++; return existing; }
    }
    stats.contactsCreated++;
    return createContact(tx, firstName, lastName, email);
  }
  const contactId = plan.match!.contactId;
  if (plan.disposition === 'update' || plan.disposition === 'conflict') {
    await updateContactName(tx, contactId, firstName, lastName); stats.namesUpdated++;
  }
  if ((plan.disposition === 'update' || plan.disposition === 'conflict' || plan.disposition === 'update-email') && email) {
    const s = await swapPrimaryEmail(tx, contactId, email);
    if (s === 'changed') stats.emailsSwapped++; else if (s === 'conflict') { stats.emailConflicts++; console.log(`    ⚠ email conflict: ${email} already active on another contact — left unchanged`); }
  }
  return contactId;
}

type ProdDealer = { id: number; name: string; status: string; province: string | null; qboLinked: boolean; contacts: ExistingContact[] };

async function applyDealer(tx: Tx, prod: ProdDealer, plans: ReconciledContact[], approvals: Map<string, boolean>): Promise<string[]> {
  const log: string[] = [];
  const approvedPlan = (p: ReconciledContact): boolean => {
    if (p.disposition === 'update' || p.disposition === 'conflict') {
      const key = `${prod.id}|${p.title}|${lower(p.bdName)}|${lower(p.bdEmail)}`;
      if (!approvals.get(key)) { stats.notApproved++; log.push(`skip(unapproved ${p.disposition}) ${p.slot} "${p.bdName}"`); return false; }
    }
    return true;
  };

  const gmPlan = plans.find((p) => p.slot === 'GM');
  const smPlan = plans.find((p) => p.slot === 'SM');
  const gmContactId = gmPlan && approvedPlan(gmPlan) ? await resolveContact(tx, gmPlan) : null;
  const smContactId = smPlan && approvedPlan(smPlan) ? await resolveContact(tx, smPlan) : null;

  let displacedHandledAsSm = false;
  if (gmContactId != null) {
    const staff = prod.contacts.filter((c) => c.role === 'staff').sort((a, b) => a.linkId - b.linkId);
    const lp = staff[0]; // current primary (lowest-id active staff link)
    const gmLink = prod.contacts.find((c) => c.role === 'staff' && c.contactId === gmContactId);
    if (gmLink && lp && gmLink.linkId === lp.linkId) {
      await tx.update(dealerContacts).set({ title: 'General Manager' }).where(eq(dealerContacts.id, lp.linkId));
      stats.gmAlreadyPrimary++; log.push(`GM "${gmPlan!.bdName}" already primary`);
    } else if (gmLink) {
      // EDGE: GM already a non-primary staff link → repoint would dup (D,contact,role). Skip, flag.
      await tx.update(dealerContacts).set({ title: 'General Manager' }).where(eq(dealerContacts.id, gmLink.linkId));
      stats.edgeSkips++; log.push(`⚠ EDGE GM "${gmPlan!.bdName}" is a non-primary staff link — title set, primary NOT changed (manual)`);
    } else if (lp) {
      // Repoint the primary link to the GM; re-link the displaced person (kept).
      const displaced = lp.contactId;
      await tx.update(dealerContacts).set({ contactId: gmContactId, title: 'General Manager', source: REFRESH_SOURCE }).where(eq(dealerContacts.id, lp.linkId));
      stats.primaryRepointed++; log.push(`repoint primary → GM "${gmPlan!.bdName}"`);
      if (displaced !== gmContactId) {
        const asSm = smContactId != null && displaced === smContactId;
        // Displaced person isn't the GM — never inherit the repointed link's old
        // title (which is now 'General Manager'), or we'd leave a phantom GM.
        await ensureStaffLink(tx, prod.id, displaced, asSm ? 'Sales Manager' : null);
        stats.displacedRelinked++;
        log.push(`keep displaced contact ${displaced}${asSm ? ' (= SM)' : ''} as secondary staff`);
        if (asSm) displacedHandledAsSm = true;
      }
    }
  }

  if (smContactId != null && !displacedHandledAsSm && smContactId !== gmContactId) {
    await ensureStaffLink(tx, prod.id, smContactId, 'Sales Manager');
    stats.smLinked++; log.push(`link SM "${smPlan!.bdName}"`);
  }
  return log;
}

async function main(): Promise<void> {
  const host = DATABASE_URL.replace(/.*@([^/?]+).*/, '$1');
  console.log(`\n=== 0091 contact-refresh WRITER ${WRITE ? '(WRITING)' : '(DRY RUN — rolls back)'} ===\ntarget: ${host}\n`);

  const file = JSON.parse(readFileSync(new URL('./data/atlantic-dealers.json', import.meta.url), 'utf8')) as AtlanticFile;
  const bdByKey = new Map(file.rows.map((r) => [dropKey(r.dealership, r.city), r]));

  const recon = parseCsv(readFileSync(new URL('./data/atlantic-reconciliation.csv', import.meta.url), 'utf8'));
  const rh = recon[0]; const rc = (n: string) => rh.indexOf(n);
  const skipRows = recon.slice(1).filter((r) => r[rc('bd_name')] && (r[rc('suggested_action')] || '').trim() === 'skip-existing');

  // approvals from the vetted preview ledger (update/conflict need approved=yes).
  const prev = parseCsv(readFileSync(new URL('./data/atlantic-contact-refresh-preview.csv', import.meta.url), 'utf8'));
  const ph = prev[0]; const pc = (n: string) => ph.indexOf(n);
  const approvals = new Map<string, boolean>();
  for (const r of prev.slice(1)) {
    const disp = r[pc('disposition')];
    if (disp === 'update' || disp === 'conflict') {
      approvals.set(`${r[pc('dealer_id')]}|${r[pc('bd_title')]}|${lower(r[pc('bd_name')])}|${lower(r[pc('bd_email')])}`, r[pc('approved')] === 'yes');
    }
  }

  // snapshot of all active dealers + contacts (read, outside the tx).
  const rows = await client<
    { dealer_id: number; dealer_name: string; province: string | null; status: string; quickbooks_id: string | null;
      link_id: number | null; contact_id: number | null; role: string | null; title: string | null;
      first_name: string | null; last_name: string | null; email: string | null }[]
  >`
    select d.id dealer_id, d.name dealer_name, d.province, d.status, d.quickbooks_id,
           dc.id link_id, c.id contact_id, dc.role::text role, dc.title, c.first_name, c.last_name,
           (select ci.value from contact_identifiers ci where ci.contact_id=c.id and ci.kind='email' and ci.is_primary and ci.archived_at is null limit 1) email
    from dealers d
    left join dealer_contacts dc on dc.dealer_id=d.id and dc.archived_at is null
    left join contacts c on c.id=dc.contact_id and c.archived_at is null
    where d.archived_at is null`;

  const dealers = new Map<number, ProdDealer>();
  for (const r of rows) {
    let d = dealers.get(r.dealer_id);
    if (!d) { d = { id: r.dealer_id, name: r.dealer_name, status: r.status, province: r.province, qboLinked: r.quickbooks_id != null, contacts: [] }; dealers.set(r.dealer_id, d); }
    if (r.link_id != null && r.contact_id != null && r.role) {
      d.contacts.push({ linkId: r.link_id, contactId: r.contact_id, role: r.role, title: r.title, name: `${(r.first_name ?? '').trim()} ${(r.last_name ?? '').trim()}`.trim(), email: r.email });
    }
  }
  const byNameProv = new Map<string, ProdDealer>();
  const byName = new Map<string, ProdDealer[]>();
  for (const d of dealers.values()) {
    byNameProv.set(`${lower(d.name)}|${lower(d.province)}`, d);
    (byName.get(lower(d.name)) ?? byName.set(lower(d.name), []).get(lower(d.name))!).push(d);
  }
  const resolveProd = (mn: string, mp: string, bn: string, bp: string) =>
    byNameProv.get(`${lower(mn)}|${lower(mp)}`) ?? byNameProv.get(`${lower(bn)}|${lower(bp)}`) ?? byName.get(lower(mn))?.[0] ?? byName.get(lower(bn))?.[0] ?? null;

  try {
    await db.transaction(async (tx) => {
      for (const r of skipRows) {
        stats.dealers++;
        const prod = resolveProd(r[rc('prod_match_name')] ?? '', r[rc('prod_match_prov')] ?? '', r[rc('bd_name')], r[rc('bd_prov')]);
        if (!prod) { stats.noMatch++; console.log(`[no-match] ${r[rc('bd_name')]}`); continue; }
        const bdRow = bdByKey.get(dropKey(r[rc('bd_name')], r[rc('bd_city')]));
        const bdContacts = bdRow ? mapRowToContacts(bdRow) : [];
        if (bdContacts.length === 0) continue;
        const plans = reconcileDealerContacts(bdContacts, prod.contacts);
        const log = await applyDealer(tx, prod, plans, approvals);
        if (log.length) { stats.dealersTouched++; console.log(`[${prod.name}] ${log.join(' · ')}`); }
      }
      if (!WRITE) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }

  console.log(`\n=== SUMMARY ${WRITE ? '(COMMITTED)' : '(DRY RUN — rolled back)'} ===`);
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(18)}: ${v}`);
}

main().then(() => client.end()).catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
