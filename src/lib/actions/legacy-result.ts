// Adapter from the next-safe-action result shape
// (`{data?, serverError?, validationErrors?}`) back to the legacy action
// shape (`{ok: true} | {error: string}`) the form callers in this app
// already understand.
//
// Why this exists: the 0033 migration changed how actions are *defined*
// (middleware-chained, schema-validated) but kept call sites stable so the
// six form callers (`dealer-form`, `people-admin`, `lookup-admin`,
// `event-detail`, `booking-form`, `availability-form`) don't need a
// flag-day rewrite. Each caller wraps its action invocation with
// `toLegacyResult(...)`.
//
// Phase 4 deletion candidate: when every form caller migrates to the native
// safe-action shape (reading `serverError` / `validationErrors` directly),
// this helper retires.

// We don't import next-safe-action's `SafeActionResult` here because it
// requires type-args we don't have at this layer (the action's data shape
// varies). The adapter only reads three optional discriminator fields, so
// a structural type fits the call sites and keeps this layer dependency-free.
type AnySafeActionResult = {
  data?: unknown;
  serverError?: string;
  validationErrors?: unknown;
};

export type LegacyActionResult<TOk extends { ok: true } = { ok: true }> =
  | TOk
  | { error: string };

export function toLegacyResult<TOk extends { ok: true } = { ok: true }>(
  result: AnySafeActionResult | undefined | null,
): LegacyActionResult<TOk> {
  if (!result) return { error: 'No response from server.' };
  if ('serverError' in result && result.serverError) {
    return { error: result.serverError };
  }
  if ('validationErrors' in result && result.validationErrors) {
    return { error: firstValidationError(result.validationErrors) };
  }
  if ('data' in result && result.data) {
    const data = result.data as
      | { ok?: boolean; error?: string }
      | (TOk & { error?: undefined })
      | undefined;
    if (data && 'error' in data && typeof data.error === 'string') {
      return { error: data.error };
    }
    if (data && 'ok' in data && data.ok === true) {
      // Pass the action's full success payload (e.g. `{ok, contactId, warning}`)
      // straight through — the caller can read additional fields the action
      // returned. The default `TOk = {ok: true}` keeps this safe at the
      // narrow call sites that only check `'ok' in result`.
      return data as TOk;
    }
  }
  return { error: 'Unknown error.' };
}

function firstValidationError(errors: unknown): string {
  // Best-effort flattening — Zod produces `{_errors: [...], fieldName: {_errors: [...]}}`
  // in the default formatted shape. Take the first message we find.
  if (typeof errors !== 'object' || errors === null) return 'Invalid input.';
  function find(node: unknown): string | null {
    if (typeof node !== 'object' || node === null) return null;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj._errors) && obj._errors.length > 0) {
      return String(obj._errors[0]);
    }
    for (const v of Object.values(obj)) {
      const m = find(v);
      if (m) return m;
    }
    return null;
  }
  return find(errors) ?? 'Invalid input.';
}
