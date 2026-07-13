import 'server-only';
import { createHash, createHmac } from 'node:crypto';

// Keyed identity fingerprint for SMS ledger continuity (0105). HMAC-SHA256
// over the normalized recipient identity (name + phone), keyed on
// SMS_IDENTITY_HMAC_KEY (base64 of 32 random bytes, `openssl rand -base64 32`).
//
// Purpose: the 24-month retention purge (0103 D5) deletes recipient names but
// the message ledger keeps a phone snapshot — and phone numbers get recycled.
// Stamping this fingerprint on recipients at import and onto message rows at
// launch lets a re-import after a purge VERIFY person-continuity (same
// name-on-number ⇒ same fingerprint) without the ledger ever holding a
// readable name. Verification-only by construction: with the key you can
// check a candidate identity, never enumerate names back out.
//
// Posture (decision.md): a keyed hash is still pseudonymous personal data
// under a strict PIPEDA reading (we hold the key) — retained as deliberate,
// documented minimization. The key is read per-call (not module-cached) so a
// rotation takes effect on the next revision, matching sealed-box.ts; note a
// rotation orphans prior fingerprints (they become permanent "no match"),
// which is acceptable — the check degrades to the bare phone key, never lies.
//
// Missing/invalid key → null (feature degrades gracefully; import and launch
// proceed with no fingerprint) rather than sealed-box's throw, because the
// fingerprint is an enhancement to the phone key, not a gate on sending.
//
// Format: `<8-hex key id>:<64-hex hmac>`. The key id (a public hash of the
// key, not of any identity) makes cross-key comparisons detectable: after a
// rotation, old ledger fingerprints carry the old key id, so
// `compareFingerprints` reads them as `unknown` — never as a false
// "name differs" warning.

const KEY_BYTES = 32;

function getKey(): Buffer | null {
  const raw = process.env.SMS_IDENTITY_HMAC_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === KEY_BYTES ? key : null;
}

// Normalization: trim, lowercase, collapse internal whitespace — so
// " Pat  CHEN " and "Pat Chen" fingerprint identically, while "Robert" vs
// "Bob" (or a typo) intentionally does not. Fields are joined with `|` to
// keep ("ann", "marie smith") distinct from ("ann marie", "smith"); literal
// pipes IN a name are folded to spaces so a crafted "ann|marie" can't forge
// the field boundary.
function normalize(part: string | null): string {
  return (part ?? '')
    .replace(/\|/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function computeIdentityHmac(input: {
  firstName: string | null;
  lastName: string | null;
  phone: string;
}): string | null {
  const key = getKey();
  if (!key) return null;
  // A fingerprint of a phone number alone adds nothing over the phone column;
  // skip nameless rows so "no name at import" reads as "no fingerprint", not
  // as a real identity that later name-carrying imports mismatch against.
  const first = normalize(input.firstName);
  const last = normalize(input.lastName);
  if (!first && !last) return null;
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 8);
  const hmac = createHmac('sha256', key)
    .update(`${first}|${last}|${input.phone}`, 'utf8')
    .digest('hex');
  return `${keyId}:${hmac}`;
}

/** Person-continuity verdict between two stored fingerprints. `unknown` when
 *  either is absent OR they were minted under different keys (rotation must
 *  never surface as a false "name differs" — decision.md D2). */
export function compareFingerprints(
  a: string | null,
  b: string | null,
): 'matches' | 'differs' | 'unknown' {
  if (!a || !b) return 'unknown';
  const keyIdOf = (s: string) => /^([0-9a-f]{8}):/.exec(s)?.[1] ?? null;
  const aKey = keyIdOf(a);
  const bKey = keyIdOf(b);
  // Different key ids ⇒ minted under different keys ⇒ not comparable.
  if (aKey && bKey && aKey !== bKey) return 'unknown';
  return a === b ? 'matches' : 'differs';
}
