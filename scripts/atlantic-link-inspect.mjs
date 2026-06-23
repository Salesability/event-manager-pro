// READ-ONLY: dump active dealer_contacts (link id / role / title / contact) for a
// few dealers, ordered by link id, to see which link the primary heuristic picks.
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const names = ['Fair Isle Ford', 'D.Alex Macdonald Ford', 'Saint John Nissan', 'Anchor Toyota'];
for (const nm of names) {
  const rows = await sql`
    select dc.id link_id, dc.role::text role, dc.title, c.first_name || ' ' || c.last_name nm,
           (select ci.value from contact_identifiers ci where ci.contact_id=c.id and ci.kind='email' and ci.is_primary and ci.archived_at is null limit 1) email
    from dealers d
    join dealer_contacts dc on dc.dealer_id=d.id and dc.archived_at is null
    join contacts c on c.id=dc.contact_id and c.archived_at is null
    where d.archived_at is null and lower(trim(d.name)) = ${nm.toLowerCase()}
    order by dc.id`;
  console.log(`\n== ${nm} == (primary = lowest-id staff)`);
  for (const r of rows) console.log(`  link ${r.link_id}  ${r.role}/${r.title || '—'}  "${r.nm}" <${r.email || '∅'}>`);
}
await sql.end();
