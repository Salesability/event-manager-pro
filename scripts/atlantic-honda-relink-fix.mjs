// One-off (0091): the Century Honda/Hyundai shared-contact collision left
// Don Graham (contact 18, Century Hyundai's GM) as a phantom 'General Manager'-
// titled SECONDARY link on Century Honda (dealer 15). Honda's real primary is now
// Jayson Pearce. Don Graham was never a Honda contact (a collision artifact), so
// archive that one erroneous link. Dry-run by default; --write to commit.
import postgres from 'postgres';
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }
const WRITE = process.argv.includes('--write');
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

const HONDA = 15, DON_GRAHAM = 18;
const before = await sql`
  select dc.id link_id, c.id cid, c.first_name||' '||c.last_name nm, dc.title,
         (select ci.value from contact_identifiers ci where ci.contact_id=c.id and ci.kind='email' and ci.is_primary and ci.archived_at is null limit 1) email
  from dealer_contacts dc join contacts c on c.id=dc.contact_id
  where dc.dealer_id=${HONDA} and dc.archived_at is null order by dc.id`;
console.log('Century Honda (dealer 15) active staff links — BEFORE:');
for (const r of before) console.log(`  link ${r.link_id}  contact ${r.cid} "${r.nm}" <${r.email||'∅'}>  title=${r.title||'—'}`);

const target = before.filter((r) => Number(r.cid) === DON_GRAHAM);
if (target.length !== 1) {
  console.log(`\nExpected exactly 1 active Don-Graham(18) link on Honda; found ${target.length}. Aborting (no change).`);
  await sql.end(); process.exit(target.length === 0 ? 0 : 1);
}
const jayson = before.find((r) => /jayson pearce/i.test(r.nm));
if (!jayson) {
  console.log('\nSafety check FAILED: Jayson Pearce not found on Honda — aborting (would not archive Don Graham without the real GM present).');
  await sql.end(); process.exit(1);
}

if (WRITE) {
  await sql`update dealer_contacts set archived_at=now() where id=${target[0].link_id} and archived_at is null`;
  console.log(`\n✅ archived link ${target[0].link_id} (Don Graham → Century Honda).`);
} else {
  console.log(`\n[dry-run] would archive link ${target[0].link_id} (Don Graham → Century Honda). Re-run with --write.`);
}
const after = await sql`
  select c.first_name||' '||c.last_name nm, dc.title from dealer_contacts dc join contacts c on c.id=dc.contact_id
  where dc.dealer_id=${HONDA} and dc.archived_at is null order by dc.id`;
console.log('\nCentury Honda active staff links — AFTER:');
for (const r of after) console.log(`  "${r.nm}"  title=${r.title||'—'}`);
await sql.end();
