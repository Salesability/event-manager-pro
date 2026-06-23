// READ-ONLY preview/diff generator for chunk 0091 (Atlantic dealer contact
// refresh — un-parks 0086-c). For each owner-vetted `skip-existing` rooftop in
// scripts/data/atlantic-reconciliation.csv, it reconciles the BD tracker's
// authoritative **General Manager** (col 6) AND **GSM/SM** (col 8) contacts (D2)
// against the CURRENT prod contacts of the matched dealer and emits a
// human-vettable per-contact ledger CSV. NO DB writes; only SELECTs + a local CSV.
// The reconciliation itself lives in the shared pure module
// `src/features/dealers/atlantic-contact-refresh.ts` (also used by the writer).
//
// One row per BD contact slot (GM, SM) + one per existing prod contact the
// worksheet omits. Disposition (D3): add / update / update-email / no-change /
// conflict / existing-unlisted / no-bd-data / no-match.
//
// Run (sandbox smoke): set -a && source .env.local && set +a && pnpm dlx tsx scripts/atlantic-contact-refresh-preview.ts --out /tmp/preview-sandbox.csv
// Run (PROD, read-only):  ./scripts/with-prod-db.sh pnpm dlx tsx scripts/atlantic-contact-refresh-preview.ts

import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { type AtlanticFile, dropKey, mapRowToContacts } from '../src/features/dealers/atlantic-import';
import { type ExistingContact, reconcileDealerContacts } from '../src/features/dealers/atlantic-contact-refresh';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL (source .env.local, or run via with-prod-db.sh).');
  process.exit(1);
}
const outArgIdx = process.argv.indexOf('--out');
const OUT_PATH =
  outArgIdx >= 0 && process.argv[outArgIdx + 1]
    ? process.argv[outArgIdx + 1]
    : new URL('./data/atlantic-contact-refresh-preview.csv', import.meta.url).pathname;

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const fullName = (first: string | null, last: string | null) =>
  `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim();

// Minimal RFC-4180-ish CSV parser (quoted fields, "" escapes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

type ProdDealer = { id: number; name: string; province: string | null; status: string; qboLinked: boolean; contacts: ExistingContact[] };

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
  const host = DATABASE_URL!.replace(/.*@([^/?]+).*/, '$1');
  console.log(`\n=== 0091 contact-refresh PREVIEW (read-only, GM+SM) ===\ntarget: ${host}\n`);

  const file = JSON.parse(
    readFileSync(new URL('./data/atlantic-dealers.json', import.meta.url), 'utf8'),
  ) as AtlanticFile;
  const bdByKey = new Map(file.rows.map((r) => [dropKey(r.dealership, r.city), r]));

  const csv = parseCsv(
    readFileSync(new URL('./data/atlantic-reconciliation.csv', import.meta.url), 'utf8'),
  );
  const head = csv[0];
  const col = (n: string) => head.indexOf(n);
  const iName = col('bd_name'), iCity = col('bd_city'), iProv = col('bd_prov');
  const iAction = col('suggested_action'), iMatch = col('prod_match_name'), iMatchProv = col('prod_match_prov');
  const skipRows = csv.slice(1).filter((r) => r[iName] && (r[iAction] || '').trim() === 'skip-existing');

  const rows = await sql<
    {
      dealer_id: number; dealer_name: string; province: string | null; status: string;
      quickbooks_id: string | null; link_id: number | null; contact_id: number | null;
      role: string | null; title: string | null; first_name: string | null; last_name: string | null; email: string | null;
    }[]
  >`
    select d.id as dealer_id, d.name as dealer_name, d.province, d.status, d.quickbooks_id,
           dc.id as link_id, c.id as contact_id, dc.role, dc.title, c.first_name, c.last_name,
           (select ci.value from contact_identifiers ci
              where ci.contact_id = c.id and ci.kind = 'email' and ci.is_primary
                    and ci.archived_at is null
              limit 1) as email
    from dealers d
    left join dealer_contacts dc on dc.dealer_id = d.id and dc.archived_at is null
    left join contacts c on c.id = dc.contact_id and c.archived_at is null
    where d.archived_at is null`;
  await sql.end();

  const dealers = new Map<number, ProdDealer>();
  for (const r of rows) {
    let d = dealers.get(r.dealer_id);
    if (!d) {
      d = { id: r.dealer_id, name: r.dealer_name, province: r.province, status: r.status, qboLinked: r.quickbooks_id != null, contacts: [] };
      dealers.set(r.dealer_id, d);
    }
    if (r.link_id != null && r.contact_id != null && r.role) {
      d.contacts.push({ linkId: r.link_id, contactId: r.contact_id, role: r.role, title: r.title, name: fullName(r.first_name, r.last_name), email: r.email });
    }
  }

  const byNameProv = new Map<string, ProdDealer>();
  const byName = new Map<string, ProdDealer[]>();
  for (const d of dealers.values()) {
    byNameProv.set(`${lower(d.name)}|${lower(d.province)}`, d);
    (byName.get(lower(d.name)) ?? byName.set(lower(d.name), []).get(lower(d.name))!).push(d);
  }
  const resolveProd = (matchName: string, matchProv: string, bdName: string, bdProv: string) =>
    byNameProv.get(`${lower(matchName)}|${lower(matchProv)}`) ??
    byNameProv.get(`${lower(bdName)}|${lower(bdProv)}`) ??
    byName.get(lower(matchName))?.[0] ??
    byName.get(lower(bdName))?.[0] ?? null;

  const out: string[][] = [[
    'dealer_id', 'dealer_name', 'prod_status', 'qbo_linked',
    'bd_title', 'bd_name', 'bd_email', 'prod_match_name', 'prod_match_email',
    'disposition', 'approved', 'detail',
  ]];
  const tally: Record<string, number> = {};
  const touchedDealers = new Set<number>();
  const touchedQboDealers = new Set<number>();
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  const APPROVED_BY_DEFAULT = new Set(['add', 'update-email']);

  for (const r of skipRows) {
    const bdName = r[iName], bdCity = r[iCity], bdProv = r[iProv];
    const prod = resolveProd(r[iMatch] ?? '', r[iMatchProv] ?? '', bdName, bdProv);
    const bdRow = bdByKey.get(dropKey(bdName, bdCity));
    const bdContacts = bdRow ? mapRowToContacts(bdRow) : [];

    if (!prod) {
      bump('no-match');
      out.push(['', r[iMatch] || bdName, '', '', '', '', '', '', '', 'no-match', '', `no active prod dealer for "${r[iMatch] || bdName}" (${r[iMatchProv] || bdProv})`]);
      continue;
    }
    if (bdContacts.length === 0) {
      bump('no-bd-data');
      const prim = prod.contacts[0];
      out.push([String(prod.id), prod.name, prod.status, prod.qboLinked ? 'yes' : 'no', '', '', '', prim?.name ?? '', prim?.email ?? '', 'no-bd-data', '', 'BD row lists no GM/SM contact']);
      continue;
    }

    for (const p of reconcileDealerContacts(bdContacts, prod.contacts)) {
      const approved = APPROVED_BY_DEFAULT.has(p.disposition) ? 'yes' : '';
      bump(p.disposition);
      if (p.disposition !== 'no-change' && p.disposition !== 'existing-unlisted') {
        touchedDealers.add(prod.id);
        if (prod.qboLinked) touchedQboDealers.add(prod.id);
      }
      out.push([
        String(prod.id), prod.name, prod.status, prod.qboLinked ? 'yes' : 'no',
        p.title, p.bdName, p.bdEmail, p.match?.name ?? '', p.match?.email ?? '',
        p.disposition, approved, p.detail,
      ]);
    }
  }

  const text = out.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
  writeFileSync(OUT_PATH, text);

  console.log(`skip-existing dealers: ${skipRows.length}`);
  console.log('per-contact disposition tally:');
  for (const k of ['add', 'update', 'update-email', 'no-change', 'conflict', 'existing-unlisted', 'no-bd-data', 'no-match']) {
    if (tally[k]) console.log(`  ${k.padEnd(17)}: ${tally[k]}`);
  }
  console.log(`dealers we'd write to: ${touchedDealers.size} (QBO-linked: ${touchedQboDealers.size} → Phase-3 push size)`);
  console.log(`\nwrote ${OUT_PATH}`);
  console.log(`→ pre-approved: "add" + "update-email". Vet (approved=yes to apply): "update" (fuzzy same-person), "conflict" (shared email/different name). "existing-unlisted" = keep by default.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
