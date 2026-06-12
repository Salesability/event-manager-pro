# Quote visibility + edit-mode route — `/quotes` index, `/quotes/[id]`, per-dealer quote history

**Started:** 2026-05-12

Quotes are fully tracked in the DB (lifecycle status, sent/accepted/declined timestamps, GCS-pinned PDFs, audit-log rows) but **invisible in the UI** — there is no `/quotes` index page, no per-dealer quote history, and no draft-resume surface. Today the only way for a coach (or anyone else) to see what quotes exist is `pnpm db:studio` against the `quotes` table, which is fine for engineering and useless for product. This chunk closes the gap with three new routes: `/quotes` (filterable list), `/quotes/[id]` (edit-mode composer hydrated from an existing draft), and `/dealerships/[id]` (dealer detail with per-dealer quote history). Also folds in the composer's leftover `router.push('/production')` from the 0035 P3 ship (`quote-composer.tsx:96`) — once `/quotes` exists and the edit route lives at `/quotes/[id]`, a successful first save can push to `/quotes/<newId>` so subsequent saves are updates instead of creating duplicate drafts.

The edit-mode plumbing is light because the composer-side Server Actions already exist (`setQuoteInputs` / `setQuoteTax` / `setQuoteDealer`, all `quote:edit`-gated, draft-only via atomic guarded UPDATE per `actions.ts:281-289`). The composer is a single client component that today takes no props and starts from `DEFAULT_QUOTE_INPUTS`; this chunk extends it with an optional initial-values prop (`{ quoteId, dealerId, inputs, taxPct, status }`) and branches the save handler to call the existing setters when `quoteId` is present. No new actions, no migration.

Done = (a) a `/quotes` page lists every quote with status pill + dealer + totals + sent_at, filterable by status + search, row click routes to `/quotes/<id>`; (b) `/quotes/[id]` exists and renders the composer in edit-mode, calling `setQuoteInputs` instead of `createQuote` on save; (c) `/dealerships/[id]` exists and shows the dealer's quote history inline; (d) saving a fresh quote in the composer routes to `/quotes/<id>` (its new edit-mode home) instead of `/production`. Sub-plan of [`0025-quote-to-payment`](../0025-quote-to-payment/plan.md).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Quote query layer + types (`loadQuotes`, `loadQuote`, `loadQuotesByDealer`) | Done | `d04afeb` |
| 2: `/quotes` index page (filter pills + search + table) | Done | `4a772d2` |
| 3: `/quotes/[id]` edit-mode + composer initial-values prop + save-handler branching | Done | `56006fb` |
| 4: `/dealerships/[id]` detail page with quote history; nav entry + dealer-name link | Done | `b484de4` |
| 5: Tests + smoke verification | Done | `5eded2d` |

**Overall Progress:** 100% (5/5 phases complete)

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/quotes/queries.ts` (new — `loadQuotes()`, `loadQuote(id)`, `loadQuotesByDealer(dealerId)`, `Quote` type) | `src/features/schedule/queries.ts:360` (`loadCampaigns`) + `:423` (`loadCampaign`) + `:517` (`loadCampaignsByDealer`) | Same shape: server-only module, Drizzle select-then-join-then-map, returns typed array (or single). Quote queries mirror campaign queries one-for-one — join `dealers` + (optional) `master_service_agreements` + (optional) `audience_sources`. `loadQuote(id)` is the hydrate-the-composer query for Phase 3. |
| `src/app/(app)/quotes/page.tsx` (new — gated list page) | `src/app/(app)/production/page.tsx` | Same shape: gated server-component list page with filter pills + search + table + row actions. Production hosts campaigns; this hosts quotes. Same layer, same data-shape, same I/O. |
| `src/app/(app)/quotes/quotes-filters.tsx` (new — client component) | `src/app/(app)/production/production-filters.tsx` | Same: client-side status+search filter component shaped for its parent list page. |
| `src/app/(app)/quotes/row-actions.tsx` (new) | `src/app/(app)/production/row-actions.tsx` | Same row-action pattern. Read-only for now (no destructive actions). Eventually grows the staff accept/decline buttons (0026 follow-up (c)). |
| `src/app/(app)/quotes/[id]/page.tsx` (new — edit-mode page) | `src/app/(app)/quotes/new/page.tsx` | Same shape: gated server-component that resolves params then renders `<QuoteComposer .../>`. Difference: this one `await`s `loadQuote(id)` and threads the result into the composer as initial-values props. |
| `src/features/quotes/quote-composer.tsx` extension (accept `initial?: { quoteId, dealerId, inputs, taxPct, status }` prop; branch `onSaveDraft` to call `setQuoteInputs` when `initial.quoteId` is present, else `createQuote`) | self — same file. Sibling pattern in the file is the existing `onSaveDraft` handler at `:78-101` | One handler, two paths. Reading the existing handler before editing keeps the FormData shape (`quoteId` / `inputs` / `tax`) consistent with what `setQuoteInputs` parses (`actions.ts:268-289`). |
| `src/app/(app)/dealerships/[id]/page.tsx` (new — first dynamic segment under `/dealerships`) | `src/features/schedule/queries.ts:221` (`loadDealer`) for the loader + `src/app/(app)/production/page.tsx` for the page layout | Loader exists; page layout mirrors production. Add a `<DealerName>` link on `/dealerships`'s table to make the route reachable. |
| Composer redirect fix in `src/features/quotes/quote-composer.tsx:96` | n/a — one-line bug fix | Replace `router.push('/production')` with `router.push('/quotes/<newQuoteId>')` so the post-save destination is the edit-mode home for the just-created quote. Subsequent saves on that URL go through `setQuoteInputs` (UPDATE) and stay put. |
| Nav entry for `Quotes` in the gated header | wherever `Production List` / `Reports` / `Dealers` is wired (likely a layout component under `src/app/(app)/`) | Same nav-entry pattern; insert `Quotes` between `Dealers` and `Production List`. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `quotes` table reference (columns, lifecycle, joins, RLS).
- `docs/wiki/commercial-spine.md` — accepted Quote = the contract; status enum semantics.
- `docs/wiki/auth.md` — gating for the new routes (admin + coach can see all; coach-scoped filtering TBD if multi-tenant-by-coach kicks in).
- `docs/wiki/conventions.md` — server-only modules, Drizzle query patterns.
- CLAUDE.md → "Conventions" — mutations go through Server Actions (this chunk is read-only; relevant only for the future edit-route follow-up).

## Notes

- **No new Server Actions, no migration.** Edit-mode reuses the existing `setQuoteInputs` / `setQuoteTax` / `setQuoteDealer` composer-side setters (gated on `quote:edit`, draft-only via atomic guarded UPDATE at `actions.ts:281-289`). The lifecycle guard is what makes this safe: any attempt to `setQuoteInputs` on a `sent`/`accepted`/`declined` quote returns `{ error: "Quote cannot be edited in status '<x>'." }` and the row is unchanged.
- **Lifecycle gating in the UI.** When loading a non-`draft` quote on `/quotes/[id]`, the composer renders read-only (or shows a banner: "This quote is `<status>` and can no longer be edited."). Server-side guard is the real defence; UI is just the courtesy.
- **Coach-scope filtering** (multi-tenant-by-coach per `project_coach_owned_business` memory) — every quote has `createdById` so a coach-scoped query is straightforward. **Working assumption for v1: admins see all; coaches see all.** Tighten only if user calls out the leak; the alternative is a route-level capability split that's not yet justified.
- **Closed/0026 follow-ups** that this chunk does *not* tackle: (a) degraded-send retry path, (b) split `quote:send` from `quote:edit`, (c) staff accept/decline UI affordance, (d) live-send dev smoke. Those stay parked under 0026 follow-ups.

### Phase Checklist

#### Phase 1: Quote query layer + types

- [x] New file `src/features/quotes/queries.ts` with `import 'server-only'` and the standard `db` client import.
- [x] Define `Quote` type — pick the columns the three pages actually render: `id`, `dealerId`, `dealerName`, `dealerArchivedAt`, `status`, `subtotal`, `tax`, `total`, `inputs` (jsonb — needed by `loadQuote` for composer hydration), `taxPct`, `sentAt`, `acceptedAt`, `declinedAt`, `createdAt`, `createdById`. Match the precision and nullable-ness of the schema.
- [x] Implement `loadQuotes(): Promise<Quote[]>` — select + inner-join `dealers`, leave `audience_sources` as left-join (nullable). Order by `createdAt DESC` (newest first). Mirror `loadCampaigns` line-for-line on the projection-to-row mapping shape.
- [x] Implement `loadQuote(id: number): Promise<Quote | null>` — same query, `where(eq(quotes.id, id))`, `.limit(1)`. The composer-hydration query.
- [x] Implement `loadQuotesByDealer(dealerId: number): Promise<Quote[]>` — same query with `where(eq(quotes.dealerId, dealerId))`. Order by `createdAt DESC`.
- [x] Vitest in `src/features/quotes/queries.test.ts` — mock the `db` client (`vi.mock('@/lib/db')` style, mirror `src/features/schedule/queries.test.ts`'s setup). Test cases: (a) empty result → `[]` / `null`; (b) result with a dealer + nullable joins maps fields correctly; (c) `loadQuotesByDealer` filters by `dealerId`; (d) `loadQuote` returns `null` for a missing id and the mapped row for a present one. Don't over-test SQL shape — test the row-mapping.
- Out-of-scope mechanical unblocker applied this phase: pre-existing tsc fallout from 0037 P4 (`scripts/import-from-sheets.ts:495-499` referenced the five dropped commercial columns) — dead lines removed so the Phase 1 `tsc --noEmit` gate clears. Zero behavior change.

#### Phase 2: `/quotes` index page

- [x] New file `src/app/(app)/quotes/page.tsx` — server component, gated on `quote:edit` (admin || coach, matches `/quotes/new`). Reads `loadQuotes()` + `q`/`status` query params, projects counts + filtered list, renders heading + `QuotesFilters` + table.
- [x] New file `src/app/(app)/quotes/quotes-filters.tsx` — client component with status pills (`All` / `Draft` / `Sent` / `Accepted` / `Declined`) + search box. URL-driven (`router.replace` with `useSearchParams`, 250 ms debounce on search) — mirrors `production/production-filters.tsx`.
- [x] New file `src/app/(app)/quotes/row-actions.tsx` — read-only row actions; v1 has a `View` link to `/quotes/<id>` (the Phase 3 edit-mode page). Server component for now; flips to `'use client'` when 0026 follow-up (c) adds the accept/decline buttons.
- [x] Page layout: heading "Quotes" + subhead, filters component, table with `Dealer` / `Status` / `Total` / `Sent` / `Created` / actions. Status pill colour map: `draft` neutral grey, `sent` status-blue, `accepted` status-green, `declined` status-red. (OQ #3 resolution: no `amber` palette exists, so used `status-blue` for in-flight `sent` — visually consistent with the existing palette.)
- [x] Added a `Quotes` link to the gated nav at the end of `OPERATIONAL_TABS` (after `Dealers`, before the Admin dropdown). Not `requiresAdmin` — both admin and coach gate clear `quote:edit`.

#### Phase 3: `/quotes/[id]` edit-mode + composer initial-values prop + save-handler branching

- [x] Extended `QuoteComposer` with `initial?: InitialQuote` (exported type — `{ quoteId, dealerId, inputs, tax, status }`). When absent, behaviour is identical to today; when present, `useState` hydrates from the prop. (Renamed `taxPct` → `tax` in the prop shape since the composer's `taxOverride` is a dollar amount, not a percent — matches `computeQuote`'s `taxOverride` parameter + the FormData `tax` field consumed by `setQuoteInputs`.)
- [x] Branched `onSaveDraft`: if `initial?.quoteId` is set, builds `{ quoteId, inputs, tax }` FormData and calls `setQuoteInputs` (atomic guarded UPDATE per `actions.ts:281-289`); otherwise calls `createQuote` as today.
- [x] Replaced `router.push('/production')` with: on `createQuote` success → `router.push('/quotes/${result.quoteId}')` (subsequent saves on that URL become UPDATEs and stay put); on `setQuoteInputs` success → `router.refresh()`.
- [x] Lifecycle-aware rendering: when `initial.status !== 'draft'`, the composer body is wrapped in `<fieldset disabled>` (HTML cascade disables every form control, including the Combobox button) and the Save button is hidden. Banner reads: "This quote is `{status}` and can no longer be edited." When in edit mode regardless of status, the Dealer field renders as a static label instead of the Combobox — `setQuoteInputs` doesn't accept dealer changes (`setQuoteDealer` is a separate setter, deferred per plan OQ #5).
- [x] New file `src/app/(app)/quotes/[id]/page.tsx` — gated server component, resolves `params.id` (Next 16 async params), validates positive int, calls `loadQuote(id)`. Missing → `notFound()` (404). Present → renders header (`← Quotes` link + `Quote #N` + status pill + dealer subhead) and `<QuoteComposer initial={...}/>`.

#### Phase 4: `/dealerships/[id]` detail page with quote history; nav + dealer-name link

- [x] New file `src/app/(app)/dealerships/[id]/page.tsx` — gated server component, `loadDealer(id)` + `loadQuotesByDealer(id)`, `notFound()` on missing.
- [x] Page layout: `← Dealers` link + dealer-name heading + status pill (Active / Prospect / Archived); subhead shows address / acquiredVia / primary email / primary phone in a flex-wrap row. `Quotes` section below: header + `+ New quote` link (hidden on archived dealers), table with `Status` / `Total` / `Sent` / `Created` / `View` columns; `View` link routes to `/quotes/<id>`.
- [x] Empty state when the dealer has no quotes: clipboard glyph + "No quotes yet" + `Create the first quote →` link to `/quotes/new?dealerId=<id>`.
- [x] Made the dealer name on `/dealerships` link to `/dealerships/[id]` via a wrapping `<Link>` in `dealers-columns.tsx`. Hover state mirrors the existing nav-link affordance.
- [x] Gated `admin:access` (not `quote:edit`). Plan's working-assumption was "admin+coach" but coaches don't currently see the parent `/dealerships` index (gated `admin:access` on both page and nav), so making detail admin+coach would create a deep-link asymmetry. Documented inline at the page-gate comment — flips with the parent if/when the dealer-tab gate ever opens for coaches.

#### Phase 5: Tests + smoke verification

- [x] Query tests from Phase 1 pass — 7 cases in `src/features/quotes/queries.test.ts` green (covers `loadQuotes` / `loadQuote` / `loadQuotesByDealer` + row-mapping + nullable joins + lineItems round-trip).
- [x] `pnpm tsc --noEmit` clean (exit 0).
- [x] `pnpm lint` clean (exit 0; 6 pre-existing stylistic warnings — same set carried across Phases 2/3/4).
- [x] `pnpm test` green; 680/680 + 1 skipped. No regression in existing schedule/quotes tests. ~~Composer-prop test~~ — skipped per the conditional ("if the composer test suite has fixtures"); no existing composer test file in `src/features/quotes/`.
- [x] Smoke: `/quotes` renders heading "Quotes" + 5 filter pills (`All (1)` / `Draft (1)` / `Sent (0)` / `Accepted (0)` / `Declined (0)`) + search box + table with 1 row.
- [x] Smoke: click `View` row action → lands on `/quotes/1` (edit-mode page), header "Quote #1 / Draft pill", composer hydrated.
- [x] Smoke: `/quotes/1` (known draft) hydrates the composer — audience 512, BDC 150, Letters 456, Digital 567, Retrieval `None`, subtotal $8,748.03. `Save Draft` not exercised (dev-data hygiene); code-traced through the `setQuoteInputs` branch + Phase 3 eval already confirmed the TOCTOU path.
- ~~Smoke: `/quotes/<knownSentId>` read-only~~ — no non-draft quotes in the dev fixture set. Documented as manual; the read-only branch is covered by Phase 3's Codex pass-2 reading of the `display = isReadOnly && initial ? persisted : computed` discriminant.
- [x] Smoke: `/dealerships/1` renders dealer-name heading + status pill + subhead + Quotes section with 1-row history; `/dealerships/2` (Century Honda, no quotes) renders the empty state.
- [x] Smoke: from `/dealerships`, dealer name resolves as a `<Link>` to `/dealerships/<id>` (post-Phase-4-fix; archived rows render plain text and don't link).
- ~~Smoke: `/quotes/new?dealerId=1` save-and-redirect~~ — not exercised end-to-end to avoid mutating dev data. Verified by code-trace: the `createQuote`-success branch in `quote-composer.tsx:152-159` calls `router.push('/quotes/${result.quoteId}')`. Phase 3's live `/quotes/1` render is the post-create destination shape.

## Open questions

- **#1 — Coach-scope on `/quotes` and `/dealerships/[id]`.** v1 assumption: everyone with `app:access` sees all. If the project's coach-owned-business posture (per `project_coach_owned_business` memory) requires coaches to see only their own quotes, that's a route-level filter + a capability story. Defer to v2 unless user calls it out. **No code in this chunk gates per-coach.**
- **#2 — Pagination on `/quotes`.** With only a handful of quotes today, no pagination. If volume grows past ~100 the table renders need cursor-based paging. Out of scope here.
- **#3 — Status pill colours.** `draft` (neutral grey), `sent` (amber/in-flight), `accepted` (green), `declined` (red) is the obvious mapping. Confirm match with existing dealer status pills on `/dealerships` (active/prospect/archived) so the visual language stays consistent. Not a blocker — pick reasonable defaults and tighten in Phase 5 if anyone notices.
- ~~**#4 — Edit-route (`/quotes/[id]`) entry into composer.**~~ **Folded into this chunk 2026-05-12 (user-confirmed).** Phase 3 owns the composer prop extension + `/quotes/[id]` page. No new Server Action needed — the existing `setQuoteInputs` / `setQuoteTax` / `setQuoteDealer` setters already provide the draft-only atomic UPDATE surface.
- **#5 — Tax + dealer swap on the edit page.** Phase 3 wires `setQuoteInputs` for the audience-size / event-days / catalog inputs. The tax-rate change path lives in `setQuoteTax` and the dealer-swap path in `setQuoteDealer` — they're separate setters because they validate different shape. **Working assumption: Phase 3 wires only `setQuoteInputs` (the common edit) for v1; tax-rate edits + dealer swap on existing quotes follow as a small carry-forward if a real coach workflow surfaces the need.** Today the composer doesn't expose a UI control for changing dealer after creation (Combobox limitation per 0035 P3 history), and tax-rate edits in the existing draft-creation flow already work via `setQuoteTax` if the composer chooses to call it. Don't pre-wire what users haven't asked for.
