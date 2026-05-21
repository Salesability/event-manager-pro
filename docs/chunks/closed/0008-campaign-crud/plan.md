# Campaign CRUD — 2026-04-30

Sub-plan 5.2 of `docs/chunks/0004-port-migration/plan.md`. The Calendar and Production views are read-only; the legacy `+ Book Event` button (`deprecated/index.html:283`), the `bookingModal` (lines 344–414), the `eventDetailModal` (lines 418–429), and the Production row View/Edit buttons (lines 1263–1264) all need to land on Postgres so the new app can replace the legacy app for day-to-day campaign management. Done = a signed-in user can create, edit, view, and (soft-)cancel a campaign from either the Calendar or Production view; the changes flow through `loadCampaigns` / the calendar slot-packing without any reload; and Phase 7 (Quote → Contract → Invoice → Payment) has a real `campaigns` row to attach quotes to.

Scope is campaign CRUD + the supporting select queries (active dealers, active coaches, active styles, active sales-lead sources). Email send (chunk 5.5), lookup-table admin (5.3), block-out dates (5.4), and the pricing/quote form (Phase 7) stay deferred. The booking modal exposes the same fields the legacy form did — date range, dealer, contact triplet, format, data source, qty/SMS/letters/BDC, coach, notes — and **does not** expose the pricing fields (`fee`, `travel`, `tax_pct`, `deposit_pct`, `quote_*`); those default to schema defaults (0 / 0 / 0 / 15 / 30) and land in Phase 7's quote UI.

**Soft-delete strategy.** `campaigns` does not carry the `archivable` mixin (no `archived_at`); the table has a `status` enum (`draft | booked | cancelled | completed`) instead. "Delete" from the legacy event-detail modal maps to `status = 'cancelled'`. The calendar / production queries already select all statuses; we'll filter `cancelled` out of the default views and surface a "Show cancelled" toggle. Hard-delete is reserved for never-saved drafts (no quote, no payment) and is out of scope here.

**Auto-fill behavior.** When a dealer is selected in the booking form, the dealer's primary `dealer_contacts(role='staff')` contact pre-fills the Contact / Phone / Email inputs (legacy `populateSelects().onchange`, lines 962–969). The user can override; the entered values persist on the `campaigns` row's `contact` / `phone` / `email` columns (which already exist for exactly this reason — per-campaign overrides of dealer-level contact info). This relies on `loadDealers` returning the primary contact (chunk 5.1's read-side fix).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Server actions (`createCampaign` / `updateCampaign` / `cancelCampaign`) + lookup queries | Done | `e729d9e`, `1feb1a3` |
| 2: Booking form (create + edit) with dealer auto-fill | Done | `1c8bb09` |
| 3: Event detail view (read-only + Edit + Cancel) | Done | `9647939` |
| 4: Wire calendar (`+ Book Event`, day-click, ribbon-click) | Done | `04225b5` |
| 5: Wire production rows (View / Edit) | Done | `3f5b655` |
| 6: Verification (tsc + vitest + dev-server smoke) | Done | `c62bd52` |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `createCampaign`, `updateCampaign`, `cancelCampaign` added to `src/features/schedule/actions.ts` | `src/features/schedule/actions.ts` `createDealer` (planned in `0007-lists-crud/plan.md` Phase 2) | Same module, same `'use server'` shape, same `{ ok } \| { error }` return contract used everywhere else in the file. |
| `loadCampaign(id)` added to `src/features/schedule/queries.ts` (single-row fetch for booking-form pre-fill) | `src/features/schedule/queries.ts:145` (`loadCampaigns`) | Sibling query — same multi-join shape, single-row variant. |
| `loadCampaignStyles()` and `loadSalesLeadSources()` added to `src/features/schedule/queries.ts` (active-only lookup reads for the form selects) | `src/features/schedule/queries.ts:64` (`loadDealers`) | Both lookup tables are simple `select id, label from <table> where archived_at is null order by label` queries — same shape as `loadDealers` minus the join. |
| `src/app/(app)/calendar/booking-form.tsx` (`'use client'`: 13-field form, `useActionState` against `createCampaign`/`updateCampaign`, dealer-select onChange auto-fill) | `src/app/(app)/lists/dealer-form.tsx` (planned in `0007-lists-crud/plan.md` Phase 4) | Same form shape: `<form action={serverAction>` wrapped with `useActionState`, hidden `id` input for edit mode, themed Base UI Dialog wrapper, `toast.success`/`error` on result. The dealer-select auto-fill is the only meaningful new behavior. |
| `src/app/(app)/calendar/event-detail.tsx` (`'use client'`: read-only campaign detail in a Base UI Dialog with Edit / Cancel buttons; mounted on the calendar page) | `src/app/(app)/lists/list-actions.tsx` (planned 5.1 Phase 4) | Same Dialog-state-holder shape — open/close state, themed Base UI Dialog, action buttons. |
| Modify `src/app/(app)/calendar/calendar-view.tsx` — wire `+ Book Event` toolbar button, day-click → open booking form pre-populated with date (legacy `selectCalDate`, line 1792), ribbon-click → open event detail (legacy line 1672) | `src/app/(app)/calendar/calendar-view.tsx` ribbon-click handler | The file already binds ribbon clicks; extend the existing handler rather than rewrite. Day-click handler today is a no-op (per `0006-port-views/plan.md` Phase 4 last task) — fill it in. |
| Modify `src/app/(app)/production/page.tsx` — replace the disabled View/Edit row buttons with handlers that open the same `<EventDetail/>` / `<BookingForm mode="edit"/>` components on this page | `src/app/(app)/production/page.tsx` (current row markup) | Production rows already render disabled stubs in port-views; swap them for working buttons. |
| `src/app/(app)/calendar/page.tsx` — extend the server fetch to also load active styles + sources for the form's selects (so the form doesn't have to round-trip on open) | `src/app/(app)/calendar/page.tsx` existing `Promise.all` of fetches | Same `Promise.all([...])` pattern; just add two more entries. |

**Conventions referenced:**
- `CLAUDE.md` / `docs/wiki/conventions.md` — Mutations through Server Actions in `src/features/<area>/actions.ts`. Same `{ ok: true } | { error: string }` contract baked into 5.1.
- `docs/wiki/data-model.md` — `campaigns` is the STAR *Marketing Campaign* (BC 6) noun. `status='cancelled'` is the soft-delete equivalent (no `archived_at` mixin on this table). Pricing columns (`fee`, `travel`, `tax_pct`, `deposit_pct`, `quote_*`) are reserved for the quote flow and not surfaced in the booking form.
- `docs/wiki/data-model.md` — `dealer_contacts(role='staff')` is the dealer-side primary contact (decided in 5.1). Auto-fill in the booking form reads from there.
- `docs/wiki/auth.md` — Server actions populate `created_by_id` / `updated_by_id` from `getUser()`; unauthenticated calls redirect to `/login`.

**Open questions resolved:**
- **Status on create** → `'booked'`. Legacy parity, simpler mental model. Phase 7 will introduce the `'draft' → 'booked'` quote-accept transition when its UI lands.
- **Cancel vs hard delete** → `'cancelled'`. Future `quotes`/`invoices` rows will FK-reference campaigns.
- **"Show cancelled" toggle** → hide cancelled by default in `/calendar` and `/production`; surface a toggle in Production filters.

**Overall Progress:** 100% (6/6 phases complete)

**Note:**
- This plan presumes 5.1 (Lists CRUD) has shipped — it relies on the toast/dialog primitives and the extended `loadDealers` (primary-contact merge) added there.
- No new schema migration needed; `campaigns` already has every column we touch.
- Pricing fields (`fee`, `travel`, `tax_pct`, `deposit_pct`, `quote_*`) are intentionally out of scope — they live on the same row but belong to Phase 7's quote UI.

### Phase Checklist

#### Phase 1: Server actions + lookup queries
- [ ] Add `loadCampaign(id: number)` to `queries.ts` returning the same shape as a single `loadCampaigns()` row.
- [ ] Add `loadCampaignStyles()` and `loadSalesLeadSources()` to `queries.ts` — `select id, label from <table> where archived_at is null order by label`.
- [ ] Add `createCampaign(formData)` to `src/features/schedule/actions.ts`:
  - Read `startDate`, `endDate` (or duration → compute), `dealerId`, `coachId`, `styleId`, `salesLeadSourceId`, `qtyRecords`, `smsEmail`, `letters`, `bdc`, `contact`, `phone`, `email`, `notes`.
  - Generate `publicId` per the import-from-sheets convention.
  - Validate: dates non-empty, `endDate >= startDate` (matches the schema CHECK constraint), `dealerId` resolves, optional ints parse to integers.
  - Insert with `status` per the resolved open question above + `createdById` / `updatedById`.
  - `revalidatePath('/calendar')`, `revalidatePath('/production')`. Return `{ ok: true }`.
- [ ] Add `updateCampaign(formData)` — same field set + `id`. Mutate by id; update `updatedById`. Revalidate both views.
- [ ] Add `cancelCampaign(formData)` — set `status = 'cancelled'`, update `updatedById`. Revalidate both views.

#### Phase 2: Booking form (create + edit)
- [ ] Build `src/app/(app)/calendar/booking-form.tsx` (`'use client'`) with the 13 inputs from legacy lines 350–406:
  - Start Date (`<input type="date">`), Duration select (1–5), End Date (read-only, computed client-side via a `useEffect` that mirrors `updateEndDate` from line 939).
  - Dealer select (active dealers only, sorted by name) — `onChange` auto-fills Contact First/Last/Phone/Email by reading from a passed-down `dealersById` map (no fetch needed since the parent server component already loaded all dealers with their primary contacts).
  - Contact / Phone / Email text inputs (editable; per-campaign override).
  - Event Format select (`campaign_styles` rows) with a tiny "⚙ Manage" link → no-op for now (chunk 5.3 will wire it).
  - Data Source select (`sales_lead_sources` rows) with the same "⚙ Manage" stub.
  - Qty Records, SMS/Email, Letters (number inputs); BDC (text input).
  - Sales Coach select (active coaches, sorted firstName lastName).
  - Notes (textarea).
- [ ] Wrap with `useActionState(createCampaign | updateCampaign, null)`. Hidden `id` input for edit mode.
- [ ] On `state.ok`: close the Dialog, `toast.success('Campaign saved')`. On `state.error`: keep open, `toast.error(state.error)`.
- [ ] Render inside the themed `<Dialog/>` from `src/components/ui/dialog.tsx` (5.1 Phase 1).

#### Phase 3: Event detail view
- [ ] Build `src/app/(app)/calendar/event-detail.tsx` (`'use client'`): read-only render of a campaign mirroring legacy `openEventDetail` rows (lines 1038–1051) — Date, Dealership, Contact triplet, Format badge, Data Source, Qty/SMS/Letters/BDC, Coach, Notes.
- [ ] Footer buttons: Cancel (`cancelCampaign`, native `confirm()` first), Edit (closes the detail dialog and opens the booking-form dialog in edit mode).
- [ ] Skip the Pricing block (lines 1052–1060) for this chunk — Phase 7 owns the quote UI.
- [ ] Email Client / Email Coach buttons render but are disabled with a small "(coming soon)" hint until 5.5 ships.

#### Phase 4: Wire calendar
- [ ] Add `+ Book Event` button to the calendar toolbar (legacy line 283, green primary button).
- [ ] Wire calendar day-click: open `<BookingForm mode="create"/>` pre-filled with the clicked date as `startDate` (legacy `selectCalDate`, line 1792).
- [ ] Wire ribbon-click: open `<EventDetail campaignId={...}/>` (legacy line 1672).
- [ ] Make sure ribbon overlay re-renders after a successful save/cancel — the server-action `revalidatePath` should be enough; verify it actually re-runs the server-component.

#### Phase 5: Wire production rows
- [ ] Replace the disabled View/Edit stubs in `src/app/(app)/production/page.tsx` with working buttons that open `<EventDetail/>` / `<BookingForm mode="edit"/>` co-located on this page.
- [ ] Add a "Show cancelled" toggle to `production-filters.tsx` (default off). Filter cancelled campaigns out of the default Production query.

#### Phase 6: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean (existing tests still pass).
- [ ] `pnpm dev` smoke:
  - [ ] Click `+ Book Event` → fill all fields → save → green toast, modal closes, ribbon appears on the calendar in the right slot.
  - [ ] Click an empty calendar day → booking modal opens with that date pre-filled.
  - [ ] Click a ribbon → event detail opens; click Edit → modal flips to edit form with values populated; change a field → save → ribbon re-renders.
  - [ ] Click Cancel on event detail → confirm dialog → green toast → ribbon disappears from default calendar; appears again when "Show cancelled" toggled on (Production).
  - [ ] Open Production view, click View on a row → same event-detail dialog renders.
  - [ ] Open Production, click Edit on a row → booking form opens in edit mode.
  - [ ] Submit booking form with `endDate < startDate` → red toast with the validation message; modal stays open.
- [ ] Update `docs/chunks/0004-port-migration/plan.md` row 5.2 to "Done" with the SHA.
- [ ] Append a one-line entry to `docs/wiki/log.md`; consider promoting "campaign CRUD" notes into a wiki page if the auto-fill / status-flip rules turn out to be load-bearing for Phase 7.
