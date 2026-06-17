// READ-ONLY probe: what would the unified "Sync" (item-mirror half) do to the
// prod catalog right now? Reports (1) the prod `service_items` state, (2) the
// connected QBO company's Items read, and (3) a DRY-RUN of the item-sync plan
// (create / update / archive / purge / skip) — replicating `classifyItemSyncPlan`
// + the empty-pull guard. No DB writes, no QBO writes — SELECT/GET only.
//
// Usage (prod):
//   QBO_TOKEN_ENC_KEY="$(gcloud secrets versions access latest --secret=quickbooks-token-enc-key --project=eventpro-498313)" \
//   QBO_ENV=production ./scripts/with-prod-db.sh node scripts/qbo-item-sync-probe.mjs

import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

const { DATABASE_URL, QBO_TOKEN_ENC_KEY, QBO_ENV } = process.env;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL (run via ./scripts/with-prod-db.sh).');
  process.exit(1);
}
// The enc key is ONLY needed for the live QBO Items GET. Without it we still
// report the catalog + connection/expiry state (DB-only), which already
// establishes most of the risk picture.
const haveEncKey = !!QBO_TOKEN_ENC_KEY?.trim();

function decrypt(payload) {
  const key = Buffer.from(QBO_TOKEN_ENC_KEY.trim(), 'base64');
  const buf = Buffer.from(payload.slice(payload.indexOf('.') + 1), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// ---- mirror of src/lib/quickbooks/item-sync.ts mapItemToServiceItem ----
const slugify = (name) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
function mapItem(item) {
  const name = (item.Name ?? '').trim();
  const sku = (item.Sku ?? '').trim();
  const type = item.Type ?? '';
  return {
    qbId: item.Id,
    code: sku || slugify(name),
    label: name,
    unitPrice: item.UnitPrice != null ? Number(item.UnitPrice).toFixed(2) : null,
    isSyncable:
      (type === 'Service' || type === 'NonInventory') &&
      item.SubItem !== true &&
      !item.ParentRef &&
      name.length > 0,
    type,
  };
}

const apiBase =
  QBO_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
const MV = '75';

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

// (1) prod catalog state
const items = await sql`
  select id, code, label, unit_price, quickbooks_id, archived_at from service_items order by code`;
const linked = items.filter((r) => r.quickbooks_id != null);
const unlinked = items.filter((r) => r.quickbooks_id == null);
const archived = items.filter((r) => r.archived_at != null);

const [conn] = await sql`
  select realm_id, access_token_enc, access_token_expires_at
  from quickbooks_connection limit 1`;
await sql.end();

console.log(`\n=== PROD service_items catalog ===`);
console.log(`total=${items.length}  linked(quickbooks_id set)=${linked.length}  unlinked=${unlinked.length}  archived=${archived.length}`);
console.log(`sample codes: ${items.slice(0, 12).map((r) => r.code).join(', ')}${items.length > 12 ? ' …' : ''}`);

if (!conn) {
  console.log(`\n=== QBO connection ===\nNO quickbooks_connection row on prod — the page shows "Not connected"; Sync is unreachable. SAFE.`);
  process.exit(0);
}
const tokenExpired = new Date(conn.access_token_expires_at) <= new Date();
console.log(`\n=== QBO connection ===`);
console.log(`realm=${conn.realm_id}  access_token_expires_at=${conn.access_token_expires_at}  expired=${tokenExpired}`);
if (tokenExpired) {
  console.log(`Token EXPIRED → the live page hits a token/fetch error (buttons hidden), and a Sync item-pull errors out before any purge. SAFE until reconnected.`);
  process.exit(0);
}
if (!haveEncKey) {
  console.log(`QBO_TOKEN_ENC_KEY not provided → skipping the live QBO Items read.`);
  console.log(`Partial risk read from DB alone: a Sync would PURGE ${unlinked.length} unlinked catalog row(s) IF (and only if) the prod QBO company returns >=1 syncable item. Re-run with the enc key to confirm what QBO returns.`);
  process.exit(0);
}

const realm = conn.realm_id;
const token = decrypt(conn.access_token_enc);
async function qboGet(path) {
  const res = await fetch(`${apiBase}/v3/company/${realm}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`QBO GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// (2) QBO Items read (paginate up to 1000)
let start = 1;
const qboItems = [];
for (let page = 0; page < 10; page++) {
  const json = await qboGet(
    `query?query=${encodeURIComponent(`SELECT * FROM Item STARTPOSITION ${start} MAXRESULTS 100`)}&minorversion=${MV}`,
  );
  const batch = json?.QueryResponse?.Item ?? [];
  qboItems.push(...batch);
  if (batch.length < 100) break;
  start += 100;
}

const mapped = qboItems.map(mapItem);
const syncable = mapped.filter((m) => m.isSyncable);

console.log(`\n=== PROD QBO company Items (realm ${realm}, env ${QBO_ENV}) ===`);
console.log(`fetched=${qboItems.length}  syncable(Service/NonInventory, top-level, named)=${syncable.length}`);
const byType = {};
for (const m of mapped) byType[m.type || '(none)'] = (byType[m.type || '(none)'] ?? 0) + 1;
console.log(`types: ${Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(', ')}`);
console.log(`syncable sample: ${syncable.slice(0, 12).map((m) => `${m.code}${m.unitPrice ? '($' + m.unitPrice + ')' : ''}`).join(', ')}${syncable.length > 12 ? ' …' : ''}`);

// (3) DRY-RUN plan (mirror classifyItemSyncPlan + the empty-pull guard)
console.log(`\n=== DRY-RUN: what a "Sync" would do to the catalog (NO writes) ===`);
if (syncable.length === 0) {
  console.log(`syncable QBO items = 0 → the empty-pull guard ABORTS with zero writes. Catalog UNTOUCHED. SAFE.`);
  process.exit(0);
}

const byQbId = new Map(linked.map((r) => [r.quickbooks_id, r]));
const activeQbIds = new Set(syncable.map((m) => m.qbId));
let create = 0, update = 0, current = 0;
const seenCreateCodes = new Set();
const linkedCodes = new Set(linked.map((r) => r.code));
for (const m of syncable) {
  const ex = byQbId.get(m.qbId);
  if (ex) {
    const differs =
      (ex.label ?? '') !== m.label ||
      Number(ex.unit_price) !== Number(m.unitPrice) ||
      ex.archived_at != null;
    differs ? update++ : current++;
  } else if (linkedCodes.has(m.code) || seenCreateCodes.has(m.code)) {
    // code-collision skip
  } else {
    seenCreateCodes.add(m.code);
    create++;
  }
}
const purge = unlinked.length; // every unlinked row is hard-deleted
const archive = linked.filter((r) => !activeQbIds.has(r.quickbooks_id) && r.archived_at == null).length;

console.log(`create=${create}  update=${update}  current(no-op)=${current}  archive=${archive}  PURGE(hard-delete)=${purge}`);
console.log('');
if (purge > 0) {
  console.log(`⚠️  A Sync would HARD-DELETE ${purge} unlinked catalog row(s) and CREATE ${create} item(s) from QBO.`);
  console.log(`   If those ${create} QBO items are NOT your real seeded SKUs, the quote composer's catalog gets replaced.`);
} else {
  console.log(`✓ No unlinked rows to purge — a Sync would only create/update/link. Low risk.`);
}
