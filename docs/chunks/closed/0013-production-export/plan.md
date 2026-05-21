# Production export + print — 2026-04-30

Stub for sub-plan 5.6 of `docs/chunks/0004-port-migration/plan.md`. Two small toolbar features the legacy Production view has but the port-views Phase 4 dropped: `⬇ Export CSV` (`deprecated/index.html:307`) and `🖨 Print` (`:308`). Done = signed-in users can export the currently-filtered Production list as a CSV and trigger a print-friendly view of the same table.

The legacy `⟳ Refresh` and `📊 Sync Sheet` buttons are intentionally not ported — they exist only to round-trip the Sheets backend that will be read-only post-cutover.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: CSV export (server action returning a Blob, or a route handler streaming text/csv) | Done | _pending commit_ |
| 2: Print view (CSS-driven; `window.print()` from a button) | Done | _pending commit_ |
| 3: Verification (tsc + vitest + dev smoke) | Done | eval-2026-05-03-1024 |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/app/(app)/production/export/route.ts:1` | sibling: `src/app/auth/callback/route.ts:1` | CSV download is an external-callable endpoint (browser triggers a file download), so route handler — not a Server Action — per `architecture.md`. |
| `src/app/(app)/production/filter.ts:1` | shared by `page.tsx` and `export/route.ts` | Avoids drift between on-screen filter and CSV filter. Pure functions, server-safe. |
| `src/app/globals.css` `@media print` block | top-level stylesheet | Print rules apply globally so `window.print()` from any future page reuses the same chrome-hiding pass. |

**Conventions referenced:**
- `docs/wiki/architecture.md` — CSV download is an external-callable endpoint, not a Server Action — route handler is the right home.
- `docs/wiki/conventions.md` — Drizzle for the SELECT used to build the CSV; respect the same `q`/`status` filter the page reads from `searchParams`.

**Overall Progress:** 100% (3/3 phases complete)

**Note:**
- The CSV columns should match the on-screen Production table: Date range, Dealership, Contact, Format, Data Source, Qty Records, SMS/Email, Letters, BDC, Coach, Notes, Status.
- Print view is just a `@media print` stylesheet that strips the toolbar/nav and lets the table flow; no separate route required.

### Phase Checklist

#### Phase 1: CSV export
- [x] Add `src/app/(app)/production/export/route.ts` (`GET`) that takes the same `q` / `status` / `cancelled` query params, runs the Production query, and streams `text/csv` with a `Content-Disposition: attachment; filename="production-YYYY-MM-DD.csv"`. (Filter logic extracted to `src/app/(app)/production/filter.ts` so the page and route can't drift.)
- [x] Add `⬇ Export CSV` button in `production-filters.tsx` that opens the route URL preserving current filters.

#### Phase 2: Print
- [x] `@media print` rules in `src/app/globals.css` (`@page` margin, white background, full-width main, `page-break-inside: avoid` on `tr`, flatten table card chrome) plus `print:hidden` Tailwind variant on `AppHeader`, `ProductionFilters`, and the row-action column.
- [x] Add `🖨 Print` button that calls `window.print()`.

#### Phase 3: Verification
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean (35/35).
- [x] `pnpm dev` smoke: eval-smoke 2026-05-03-1024 — `/production/export?status=upcoming` (auth) returned `Content-Disposition: attachment` (Playwright "Download is starting"); print PDF rendered without app header / filters / action column. Slight right-edge clipping noted as future polish. Codex flagged 1 medium (CSV formula injection) + 3 low; deferred — see eval report.
