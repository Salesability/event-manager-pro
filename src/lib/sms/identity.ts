import 'server-only';
import { createHmac } from 'node:crypto';

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
// keep ("ann", "marie smith") distinct from ("ann marie", "smith").
function normalize(part: string | null): string {
  return (part ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  return createHmac('sha256', key)
    .update(`${first}|${last}|${input.phone}`, 'utf8')
    .digest('hex');
}
