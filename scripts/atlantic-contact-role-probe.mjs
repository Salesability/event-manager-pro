// READ-ONLY probe (0091): for the 86 skip-existing dealers, what ROLE are their
// existing contacts, and would a newly-added staff GM out-prioritize them to
// become the resolved "primary"? (primary = lowest-linkId staff > customer > prospect)
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }
const lower = (s) => (s ?? '').trim().toLowerCase();

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c; }
  if (field.length || row.length) { row.push(field); rows.push(row); } return rows;
}
const csv = parseCsv(readFileSync(new URL('./data/atlantic-reconciliation.csv', import.meta.url), 'utf8'));
const h = csv[0]; const ci = (n) => h.indexOf(n);
const skip = csv.slice(1).filter((r) => r[ci('bd_name')] && (r[ci('suggested_action')] || '').trim() === 'skip-existing');

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const rows = await sql`
  select d.id, lower(trim(d.name)) nm, lower(trim(coalesce(d.province::text,''))) prov,
         dc.role::text role, dc.id link_id
  from dealers d
  left join dealer_contacts dc on dc.dealer_id=d.id and dc.archived_at is null
  where d.archived_at is null`;
await sql.end();

const byKey = new Map();
for (const r of rows) {
  const k = `${r.nm}|${r.prov}`;
  if (!byKey.has(k)) byKey.set(k, []);
  if (r.role) byKey.get(k).push(r.role);
  byKey.set(`id:${r.nm}`, byKey.get(`id:${r.nm}`) || byKey.get(k));
}
const byName = new Map();
for (const r of rows) { const k = r.nm; if (!byName.has(k)) byName.set(k, []); if (r.role) byName.get(k).push(r.role); }

const roleTally = {};
let hasStaff = 0, noStaff = 0, noContacts = 0, unresolved = 0;
for (const s of skip) {
  const mn = lower(s[ci('prod_match_name')]) || lower(s[ci('bd_name')]);
  const mp = lower(s[ci('prod_match_prov')]) || lower(s[ci('bd_prov')]);
  const roles = byKey.get(`${mn}|${mp}`) ?? byName.get(mn);
  if (!roles) { unresolved++; continue; }
  for (const r of roles) roleTally[r] = (roleTally[r] || 0) + 1;
  if (roles.length === 0) noContacts++;
  else if (roles.includes('staff')) hasStaff++;
  else noStaff++;
}
console.log('\n=== existing-contact ROLE distribution across the 86 skip-existing dealers ===');
console.log('role counts (all existing links):', roleTally);
console.log(`\ndealers with >=1 existing STAFF contact : ${hasStaff}  <- a new staff GM would NOT auto-become primary`);
console.log(`dealers with contacts but NO staff      : ${noStaff}  <- a new staff GM WOULD auto-become primary`);
console.log(`dealers with NO existing contacts       : ${noContacts}`);
console.log(`unresolved                              : ${unresolved}`);
