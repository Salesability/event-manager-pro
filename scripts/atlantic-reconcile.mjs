// READ-ONLY reconciliation worksheet generator (chunk 0086, Phase 6 prep).
// Cross-references the cleaned BD list against the existing prod dealer base and
// writes a human-vettable CSV (scripts/data/atlantic-reconciliation.csv). No DB
// writes. The Excel has no street/postal, and dealer GROUPS share phones + postal
// codes across distinct brand rooftops (e.g. Subaru/Acura/Audi/VW of Moncton all
// at E1A9A3), so NO single key is trustworthy — this surfaces evidence + a
// suggested action and leaves the ambiguous middle ("review") for the owner.
//
// Usage (prod): QBO_ENV=production ./scripts/with-prod-db.sh node scripts/atlantic-reconcile.mjs
//   (then open scripts/data/atlantic-reconciliation.csv, vet the `suggested_action`
//    column for `review` rows, and the import will honor your edits.)

import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('Missing DATABASE_URL (run via with-prod-db.sh).'); process.exit(1); }

const lower = (s) => (s ?? '').trim().toLowerCase();
const phone10 = (s) => (s ?? '').replace(/\D/g, '').slice(-10);
const isTollFree = (p) => /^(800|833|844|855|866|877|888)/.test(p);

// Significant name tokens — drop corporate/category filler so "Audi Moncton" and
// "Audi of Moncton" share tokens, but brand + place + family names survive.
const STOP = new Set(['of','the','a','and','ltd','limited','inc','incorporated','co','company',
  'automotive','auto','motors','motor','group','cars','car','sales','centre','center','dealership']);
// Vehicle brands/models — shared across every dealer of that brand, so they are
// NOT distinctive for entity resolution ("Audi St John's" vs "BMW St John's" must
// NOT fuzzy-match on the shared place). The distinctive signal is the group/family
// name (Norrad, Lounsbury, Hickman, Bruce, Steele, Rallye, O'Regan's).
const BRAND = new Set(['chrysler','dodge','jeep','ram','cdjr','ford','lincoln','honda','toyota',
  'hyundai','kia','mazda','nissan','subaru','volkswagen','vw','audi','bmw','mini','mercedes',
  'benz','gmc','buick','chevrolet','chevy','cadillac','acura','lexus','volvo','mitsubishi']);
function sigTokens(name) {
  return new Set(
    lower(name).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
      .filter((t) => t && !STOP.has(t)),
  );
}
// Distinctive = significant tokens minus brand/model minus the rooftop's own city
// words (a place + brand coincidence isn't a match).
function distinctive(name, cityWords = new Set()) {
  return new Set([...sigTokens(name)].filter((t) => !BRAND.has(t) && !cityWords.has(t)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

// BD rooftops (after drop-list + name+city dedup)
const doc = JSON.parse(readFileSync(new URL('./data/atlantic-dealers.json', import.meta.url), 'utf8'));
const drop = new Set(doc.dropList.map((d) => `${lower(d.name)}|${lower(d.city)}`));
const seen = new Set();
const bd = [];
const bdPhoneCount = {};
for (const r of doc.rows) {
  const key = `${lower(r.dealership)}|${lower(r.city)}`;
  if (drop.has(key) || seen.has(key)) continue;
  seen.add(key);
  const p = phone10(r.phone);
  bd.push({ name: r.dealership, city: r.city, prov: r.province, phone: p, mfr: r.manufacturer, tokens: sigTokens(r.dealership) });
  if (p) bdPhoneCount[p] = (bdPhoneCount[p] || 0) + 1;
}

// prod dealers + their contact phones
const rows = await sql`
  select d.id, d.name, d.address, d.province, d.status,
         array_remove(array_agg(distinct ci.value) filter (where ci.kind='phone' and ci.archived_at is null), null) phones
  from dealers d
  left join dealer_contacts dc on dc.dealer_id=d.id and dc.archived_at is null
  left join contact_identifiers ci on ci.contact_id=dc.contact_id
  where d.archived_at is null
  group by d.id, d.name, d.address, d.province, d.status`;
await sql.end();

const prod = rows.map((d) => ({
  name: d.name, address: d.address, prov: d.province, status: d.status,
  phones: (d.phones || []).map(phone10).filter(Boolean), tokens: sigTokens(d.name),
}));
const prodByName = new Map();
for (const p of prod) (prodByName.get(lower(p.name)) || prodByName.set(lower(p.name), []).get(lower(p.name))).push(p);
const prodByPhone = new Map();
for (const p of prod) for (const ph of p.phones) (prodByPhone.get(ph) || prodByPhone.set(ph, []).get(ph)).push(p);

// A fuzzy match must share a DISTINCTIVE (non-brand, non-city) token — i.e. the
// dealer-group/family name — not just a brand + place coincidence. Among those,
// rank by full-token Jaccard so same-brand variants score above cross-brand ones.
function bestFuzzy(b) {
  const cityWords = sigTokens(b.city); // same tokenizer as names (handles "St. John's")
  const bDist = distinctive(b.name, cityWords);
  if (!bDist.size) return null;
  let best = null, score = 0;
  for (const p of prod) {
    const shared = [...bDist].some((t) => distinctive(p.name).has(t));
    if (!shared) continue;
    const s = jaccard(b.tokens, p.tokens);
    if (s > score) { score = s; best = p; }
  }
  return score >= 0.4 ? { p: best, score } : null;
}

const out = [['bd_name','bd_city','bd_prov','bd_phone','bd_manufacturer','match_type','suggested_action','prod_match_name','prod_match_prov','prod_match_status','prod_match_address','evidence','flags']];
const tally = { 'import-new': 0, 'skip-existing': 0, review: 0 };

for (const b of bd) {
  const exact = prodByName.get(lower(b.name)) || [];
  const exactSameProv = exact.find((p) => p.prov === b.prov) || exact[0];
  const byPhone = b.phone ? (prodByPhone.get(b.phone) || []) : [];
  const phoneShared = b.phone ? (prodByPhone.get(b.phone)?.length > 1) : false;
  const flags = [];
  if (b.phone && bdPhoneCount[b.phone] > 1) flags.push('phone shared across BD rooftops');
  if (b.phone && isTollFree(b.phone)) flags.push('toll-free');
  if (phoneShared) flags.push(`phone on ${prodByPhone.get(b.phone).length} prod dealers (group switchboard?)`);

  let matchType, action, match = null, evidence = '';
  const phoneToExact = exactSameProv && exactSameProv.phones.includes(b.phone);

  if (exactSameProv && phoneToExact) {
    matchType = 'name+phone'; action = 'skip-existing'; match = exactSameProv; evidence = 'name exact + phone match';
  } else if (exactSameProv && exactSameProv.prov === b.prov) {
    matchType = 'name-only'; action = 'skip-existing'; match = exactSameProv; evidence = 'name exact, same province (phone differs/absent)';
  } else if (exact.length) {
    matchType = 'name-diff-prov'; action = 'review'; match = exact[0]; evidence = 'name exact but DIFFERENT province — verify';
  } else if (byPhone.length && !phoneShared && !(b.phone && isTollFree(b.phone))) {
    matchType = 'phone-only'; action = 'review'; match = byPhone[0]; evidence = `phone match, name differs → "${byPhone[0].name}" (variant?)`;
  } else if (byPhone.length) {
    matchType = 'phone-shared'; action = 'review'; match = byPhone[0]; evidence = `phone match but SHARED/toll-free → "${byPhone[0].name}" (likely a group, not same rooftop)`;
  } else {
    const fz = bestFuzzy(b);
    if (fz) {
      // Reached the fuzzy branch ⇒ this rooftop's phone matched NO prod dealer.
      // Owner's rule: a distinct phone means a distinct rooftop. So a group-name
      // match (O'Regan's, Hickman, Lounsbury…) with a distinct phone AND a
      // different brand OR a different town is a NEW rooftop of an existing group,
      // not the matched dealer. Near-identical-name variants (same brand+town,
      // e.g. "Fairley & Stevens" vs "Fairley and Stevens") stay in review so a
      // typo-dup isn't auto-imported.
      const brandBD = [...sigTokens(b.name)].filter((t) => BRAND.has(t));
      const brandProd = [...sigTokens(fz.p.name)].filter((t) => BRAND.has(t));
      const brandDiffers = brandBD.length > 0 && brandProd.length > 0 && !brandBD.some((t) => brandProd.includes(t));
      const cityWords = sigTokens(b.city);
      const prodAddr = sigTokens(fz.p.address || '');
      const townDiffers = cityWords.size > 0 && ![...cityWords].some((t) => prodAddr.has(t));
      if (b.phone && (brandDiffers || townDiffers)) {
        matchType = 'group-other-rooftop'; action = 'import-new'; match = fz.p;
        evidence = `same group as "${fz.p.name}" but distinct phone + ${brandDiffers ? 'different brand' : 'different town'} → new rooftop`;
      } else {
        matchType = 'fuzzy-name'; action = 'review'; match = fz.p;
        evidence = `fuzzy name ~ "${fz.p.name}" (score ${fz.score.toFixed(2)})`;
      }
    } else { matchType = 'none'; action = 'import-new'; evidence = 'no name/phone/fuzzy match'; }
  }

  tally[action]++;
  out.push([
    b.name, b.city, b.prov, b.phone, b.mfr, matchType, action,
    match?.name ?? '', match?.prov ?? '', match?.status ?? '', match?.address ?? '',
    evidence, flags.join('; '),
  ]);
}

const csv = out.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
const path = new URL('./data/atlantic-reconciliation.csv', import.meta.url);
writeFileSync(path, csv);
console.log(`wrote scripts/data/atlantic-reconciliation.csv (${bd.length} rooftops)`);
console.log(`suggested actions → import-new: ${tally['import-new']}  skip-existing: ${tally['skip-existing']}  review: ${tally.review}`);
console.log(`(open it, vet the "review" rows' suggested_action, then the import will honor the column.)`);
