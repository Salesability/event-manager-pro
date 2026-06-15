# Decision — `quotes.tax_override` column: keep (Option A)

**Date:** 2026-06-15
**Decided by:** owner ("build 0080 with keep the column")

## Decision

**Keep the `quotes.tax_override` column (expand→contract).** Stop reading and writing it; the composer
and the Server Actions no longer set or carry it forward. **No migration in this chunk.** A later
cleanup chunk can drop the column once the keep-it-unused state is verified in production.

## Why Option A over dropping it now

- **`db-conventions` preference:** expand→contract — never drop a column in the same chunk that stops
  using it; ship the stop-using, verify, then drop later. Avoids a risky immediate `DROP COLUMN`.
- **Zero risk to existing quotes — confirmed by code, not just assumed.** A persisted quote's tax is
  the stored `quotes.tax` / `quotes.total` snapshot. No **render/read** path recomputes tax from
  `tax_override`:
  - `sendQuote` selects + uses `quotes.tax` / `quotes.total` (persisted) — it does not read
    `tax_override`.
  - `render-quote.ts` takes the tax as a passed-in value (from the persisted snapshot) — no
    `tax_override` reference.
  - The composer's read-only display uses `initial.tax` (persisted); only the *edit-mode live
    preview* recomputes, and only from the in-form value.
  - So removing the write path changes only what a **future re-edit/re-save** computes (→ the auto
    province rate, the intended behaviour) — it cannot retroactively alter an already-sent quote's
    numbers. Keeping the column simply preserves the historical "was overridden" marker.
- **No migration → smaller, safer chunk** that ships behind the same prod path as 0078.

## Prod data-impact check — deferred (informational only under Option A)

The plan's Phase 1 also called for counting prod quotes with a non-null `tax_override`. That check is
**blocked on `gcloud auth login`** (prod token expired 2026-06-15) and is **not needed for Option A**:
keeping the column means no data changes and no migration, so the prod count would only tell us *how
many prod quotes would recompute to the auto rate on their next edit* — useful context, not a gate.
Sandbox baseline (captured 2026-06-15): **5 overridden — 3 `sent` + 2 `accepted`**. Pull the prod
number opportunistically the next time the prod token is fresh; it does not block this chunk.

## Consequence for the plan

- **Phase 4 (schema)** is a no-migration no-op: add a comment on `quotes.tax_override` marking it
  retained-but-unused (0080), pending a later contract migration. No `drizzle-kit generate`.
- The `db-conventions` skill is therefore **not** invoked for a migration this chunk.
