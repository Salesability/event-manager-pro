// Target guard for the demo-seed runner (0111). Pure so the refusal rules are
// unit-testable without a connection; the runner exits non-zero on any `ok:
// false` verdict BEFORE constructing a client (intent: "non-zero exit before
// any DB write"). Same belt-and-suspenders doctrine as `with-prod-db.sh` /
// `deploy.sh`'s typed prod confirm, pointed the opposite direction: seeds must
// never reach prod, and anything unrecognized needs an explicit opt-in.

// Supabase project refs identify the database regardless of pooler host/port
// (see docs/wiki/go-live-accounts.md).
const PROD_REF = 'fkfybeddnfxnjuxkqidp';
const SANDBOX_REF = 'qppenapeguwevcheqwpz';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** Env flag that admits an unrecognized (non-sandbox, non-local) target. */
export const UNKNOWN_TARGET_OPTIN = 'SEED_DEMO_ALLOW_UNKNOWN_TARGET';

export type SeedTargetVerdict =
  | { ok: true; label: string }
  | { ok: false; reason: string };

export function classifySeedTarget(
  databaseUrl: string | undefined,
  allowUnknownTarget: boolean,
): SeedTargetVerdict {
  if (!databaseUrl) {
    return { ok: false, reason: 'Missing env: DATABASE_URL (source .env.local first)' };
  }
  // Hard refusal — no flag can override this branch.
  if (databaseUrl.includes(PROD_REF)) {
    return {
      ok: false,
      reason: `DATABASE_URL contains the PRODUCTION project ref (${PROD_REF}) — demo seeds never run against prod. No opt-in exists for this.`,
    };
  }
  if (databaseUrl.includes(SANDBOX_REF)) {
    return { ok: true, label: `sandbox (${SANDBOX_REF})` };
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a parseable URL.' };
  }
  if (LOCAL_HOSTS.includes(host)) {
    return { ok: true, label: `local (${host})` };
  }
  if (allowUnknownTarget) {
    return { ok: true, label: `unknown target ${host} (${UNKNOWN_TARGET_OPTIN} opt-in)` };
  }
  return {
    ok: false,
    reason: `DATABASE_URL points at unrecognized host "${host}" (not the sandbox ref or localhost). Re-run with ${UNKNOWN_TARGET_OPTIN}=1 if this is intentional.`,
  };
}
