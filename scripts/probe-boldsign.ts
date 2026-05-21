// Throwaway: probe BoldSign auth with raw fetch, bypassing the `boldsign`
// SDK and our `src/lib/boldsign/client.ts`. Three GETs against both regions
// hit a list endpoint that requires authentication but mutates nothing.
//
// Run:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/probe-boldsign.ts
//
// Interpreting:
//   - 200 from US, 401 from EU → key is US-region, current BASE_URL is correct.
//   - 401 from US, 200 from EU → key is EU-region; need to change BASE_URL in
//     src/lib/boldsign/client.ts to https://api-eu.boldsign.com.
//   - 401 from both         → key itself is invalid (regenerate in console).
//   - non-2xx/401 other     → account-level issue (unverified, suspended).

const KEY = process.env.BOLDSIGN_API_KEY;
if (!KEY) {
  console.error('Missing env: BOLDSIGN_API_KEY');
  process.exit(1);
}

console.log('Key shape:');
console.log(`  length:         ${KEY.length}`);
console.log(`  trimmed length: ${KEY.trim().length}`);
console.log(`  starts with:    ${JSON.stringify(KEY.slice(0, 4))}`);
console.log(`  ends with:      ${JSON.stringify(KEY.slice(-4))}`);
console.log(`  has quotes:     ${/^['"]|['"]$/.test(KEY)}`);
console.log(`  has whitespace: ${/\s/.test(KEY)}`);
console.log();

const REGIONS = [
  { name: 'US', url: 'https://api.boldsign.com' },
  { name: 'EU', url: 'https://api-eu.boldsign.com' },
  { name: 'CA', url: 'https://api-ca.boldsign.com' },
] as const;

async function probe(name: string, base: string) {
  // /v1/document/list?Page=1&PageSize=1 — read-only, requires auth, costs
  // nothing. Per BoldSign docs the header is `X-API-KEY`.
  const url = `${base}/v1/document/list?Page=1&PageSize=1`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-KEY': KEY!, Accept: 'application/json' },
    });
    const body = await res.text();
    const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    console.log(`[${name}] ${res.status} ${res.statusText}`);
    console.log(`        body: ${snippet}`);
  } catch (err) {
    console.log(`[${name}] network error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

(async () => {
  for (const r of REGIONS) {
    await probe(r.name, r.url);
  }
})();
