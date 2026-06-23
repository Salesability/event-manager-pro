// READ-ONLY (0091): find contacts linked to MORE THAN ONE of the 86 skip-existing
// dealers — those are shared records that the per-dealer refresh can mangle when
// the BD tracker names different people at each rooftop. Shows current state.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }
const lower = (s) => (s ?? '').trim().toLowerCase();
function parseCsv(t){const R=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}else if(c==='"')q=true;else if(c===','){r.push(f);f='';}else if(c==='\n'){r.push(f);R.push(r);r=[];f='';}else if(c!=='\r')f+=c;}if(f.length||r.length){r.push(f);R.push(r);}return R;}
const csv = parseCsv(readFileSync(new URL('./data/atlantic-reconciliation.csv', import.meta.url), 'utf8'));
const h = csv[0]; const ci=(n)=>h.indexOf(n);
const skip = csv.slice(1).filter((r)=>r[ci('bd_name')] && (r[ci('suggested_action')]||'').trim()==='skip-existing');
const wantNames = new Set(skip.map((r)=>`${lower(r[ci('prod_match_name')]||r[ci('bd_name')])}`));

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const rows = await sql`
  select d.id did, d.name dname, c.id cid, c.first_name||' '||c.last_name nm,
         dc.id link_id, dc.role::text role, dc.title,
         (select ci.value from contact_identifiers ci where ci.contact_id=c.id and ci.kind='email' and ci.is_primary and ci.archived_at is null limit 1) email
  from dealers d
  join dealer_contacts dc on dc.dealer_id=d.id and dc.archived_at is null
  join contacts c on c.id=dc.contact_id and c.archived_at is null
  where d.archived_at is null`;
await sql.end();

// keep only the 86 dealers
const inSet = rows.filter((r)=>wantNames.has(lower(r.dname)));
const byContact = new Map();
for (const r of inSet) { if(!byContact.has(r.cid)) byContact.set(r.cid, []); byContact.get(r.cid).push(r); }
const shared = [...byContact.entries()].filter(([,ls])=>new Set(ls.map((l)=>l.did)).size>1);
console.log(`\ncontacts shared across >1 of the 86 dealers: ${shared.length}`);
for (const [cid, ls] of shared) {
  console.log(`\ncontact ${cid}  "${ls[0].nm}" <${ls[0].email||'∅'}>  linked to:`);
  for (const l of ls) console.log(`   - dealer ${l.did} "${l.dname}"  (${l.role}/${l.title||'—'})`);
}
