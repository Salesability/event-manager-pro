// Adapter: maps a `LegacyActionResult` (from `toLegacyResult`) into RHF's
// per-field `setError` plumbing. Pairs with the shadcn `<Form>` stack — the
// form's submit handler awaits the Server Action result, then either
// resolves cleanly (caller proceeds with toast / router.refresh) or surfaces
// the error inline against the named field (or at form level when no field
// name is supplied).
//
// 0042 Phase 2. First consumer lands in Phase 4 (`dealer-form` / `booking-form`).
// Phase 3 (`quote-composer` port) inlines the same 5 lines since it's the
// single first consumer per the plan's OQ#4 resolution (`inline at the first
// form, share helper at the second`).
//
// Shape note: the helper accepts a `fieldMap` so the action's error string
// can be routed to the right RHF field — e.g. `{ 'duplicate_email': 'email' }`.
// Unmapped errors fall through to the root form-level error, surfaced via
// `<FormMessage>` on the form wrapper.

import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { LegacyActionResult } from './legacy-result';

export type FormBindOptions<TFieldValues extends FieldValues> = {
  /** Maps a substring of `result.error` to a RHF field name. First match
   *  wins; if no entry matches, the error lands on the root form scope. */
  fieldMap?: Partial<Record<string, Path<TFieldValues>>>;
};

export function bindFormError<TFieldValues extends FieldValues>(
  result: LegacyActionResult,
  setError: UseFormSetError<TFieldValues>,
  options: FormBindOptions<TFieldValues> = {},
): { ok: true } | { ok: false } {
  if ('ok' in result && result.ok) return { ok: true };
  if (!('error' in result)) return { ok: false };

  const message = result.error;
  const fieldMap = options.fieldMap ?? {};
  for (const [needle, fieldName] of Object.entries(fieldMap)) {
    if (fieldName && message.toLowerCase().includes(needle.toLowerCase())) {
      setError(fieldName, { type: 'server', message });
      return { ok: false };
    }
  }
  // Fall through: root-level error. RHF v7 accepts `root` as a synthetic
  // field name; consumers render it via `formState.errors.root?.message`
  // alongside the `<FormMessage>` slot.
  setError('root' as Path<TFieldValues>, { type: 'server', message });
  return { ok: false };
}
