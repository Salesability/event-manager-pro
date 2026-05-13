# Portal shell + master/detail conventions

**Started:** 2026-05-13
**Status:** Active — pivoted 2026-05-13 to **keep the top nav** (`AppHeader`) and drop the shadcn Sidebar shell swap. Reframed same day around **app-wide consistency in operation and look-and-feel** rather than page conventions alone (user reframe + bcgov/biohubbc-platform structural reference). Phase 1 stays `Skipped`; new Phase 6 (row-action convention) inserted; old Phases 6–7 renumber to 7–8.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: shadcn Sidebar install + portal shell swap | Skipped (pivot 2026-05-13 — keep top nav) | - |
| 2: `<PageHeader>` wrapper (title + actions slot) | Done | d440fe9 |
| 3: Sweep `<PageHeader>` across all `(app)/` routes | Done | 2541149 |
| 4: Detail-page convention (key-value strip + sections) | Done | 2ce556b |
| 5: List-page filter-bar convention | Pending | - |
| 6: Row-action convention (`<RowActions>` + shared labels/icons) | Pending | - |
| 7: Status `<Badge>` + relative timestamps | Pending | - |
| 8: Wiki (`layout.md`) + chunk-end smoke | Pending | - |

**Spirit (locked 2026-05-13):** the same conceptual surface should look and operate the same way everywhere. Concrete evidence motivating the chunk — three list pages, three different operational vocabularies for "do something to this row":

| List | Labels on row | File |
|------|---------------|------|
| `/quotes` | `View` only | `src/app/(app)/quotes/row-actions.tsx:16` |
| `/production` | `View` + `Edit` | `src/app/(app)/production/row-actions.tsx:37,44` |
| `/dealers` | `Activate` + `Edit` + `Archive` (no `View`) | `src/features/dealers/dealers-columns.tsx:113-162` |

That mismatch is a vocabulary problem, not a styling problem — fixing it requires one shared row-action component fed by a shared labels/icons map, not just nicer buttons. Structural reference: [bcgov/biohubbc-platform `app/src`](https://github.com/bcgov/biohubbc-platform/tree/dev/app/src) — note `components/data-grid/`, `components/button/`, `components/header/`, `components/section/`, `layouts/BaseLayout.tsx` + `SearchLayout.tsx`, `constants/i18n.ts` + `icon.ts`. We don't need their MUI theme or their full i18n harness; we do need their *organizational shape* — one folder per pattern, labels/icons centralized.

Keep the existing top-header portal shell (`AppHeader`) and establish app-wide conventions for: (a) **page header with top-right action slot** — fixes hidden-below-fold + hand-rolled submit pain; (b) **detail-page key-value strip + sections** — same anatomy on `/quotes/[id]` and `/dealerships/[id]`; (c) **list-page filter-bar shape** — search-flex → fixed dropdowns → action-right; (d) **row-action vocabulary** — one `<RowActions>` component, canonical labels (`View`/`Edit`/`Archive`/etc.) drawn from a shared `labels.ts`, overflow → dropdown; (e) **status `<Badge>`** — variants per enum value, replacing colored-text status spans; (f) **relative timestamps** — `<RelativeTime>` for *recent activity* (list timestamps, send history) and absolute for *scheduled facts* (event dates, contract dates); (g) **`docs/wiki/layout.md`** — captures the whole convention set and is cross-linked from `index.md` + `forms.md`.

**Overall Progress:** 43% (3/7 active phases complete; Phase 1 skipped)

## Decisions locked

- **Spirit: consistency, not aesthetic refresh.** Every change in this chunk must justify itself by making one of: row actions, page headers, detail-page anatomy, list filter-bars, status display, timestamps — *operate and look the same everywhere they appear*. Nicer-looking-but-still-inconsistent is a fail. Pretty-but-localized changes belong in their own chunks.
- **Canonical row-action vocabulary** (Phase 6 — locks the labels before any sweep):
  - `View` — navigate to the record's detail page. Used when there *is* a detail page.
  - `Edit` — open an inline edit dialog. Used when the record has no detail page (or the dialog is the canonical editor).
  - `Archive` / `Activate` / state-flip verbs — terminal column, after `View`/`Edit`.
  - Overflow (4+ actions, or rarely-used) → kebab menu (`<DropdownMenu>`).
  - **Either `View` xor `Edit` for navigation, never both.** `/production`'s current `View + Edit` pair is the lint: pick one based on whether the row has a detail page.
  - Labels live in `src/lib/ui/labels.ts` (string constants), not as inline literals — so the choice can't drift back.
- **Action-slot placement.** Page-level primary actions live in **`<PageHeader actions>`** (top-right of content area), never at the bottom of a scrolling page. Dialog actions stay in `DialogFooter` (bottom) — that's canonical dialog UX and not in scope here.
- **Sticky page header on long pages only.** `<PageHeader sticky>` opts in; default is non-sticky. Quote composer is the clearest candidate (line-items table can scroll past the fold). Most pages don't need sticky and the gain isn't worth the visual weight.
- **Keep the top nav** (pivot 2026-05-13). `AppHeader` stays as the portal shell; we are not migrating to a shadcn Sidebar in this chunk. The existing capability-gated `app-nav.tsx` continues to drive nav items inside `AppHeader`. Rationale: shell swap is a high-blast-radius change for a payoff that's primarily aesthetic; the real user pain (hidden actions, hand-rolled buttons, inconsistent detail/list pages) is fully addressed by Phases 2–6 without touching the shell.
- **Sticky `<PageHeader>` sits below the sticky `AppHeader`.** AppHeader is sticky-top, 64px tall. `<PageHeader sticky>` uses `sticky top-16` (not `top-0`) so it parks just under the AppHeader rather than colliding with it. Z-index: page header `z-10`, AppHeader stays at whatever it already has (higher).
- **Capability-gated nav preserved verbatim.** No change to *who sees what*; this chunk only touches the content-area shell (page header + detail/list conventions + status badges).

## Open Questions

~~1. **Sidebar collapse mode.**~~ N/A — pivoted 2026-05-13, no sidebar.
~~2. **Sidebar header content.**~~ N/A — pivoted, no sidebar.
~~3. **Sidebar footer content.**~~ N/A — pivoted, no sidebar.
~~4. **Mobile breakpoint.**~~ N/A — pivoted; existing `AppHeader` mobile behavior is the baseline and untouched by this chunk.

5. **`<PageHeader>` API.** Two-prop minimum (`title`, `actions`) vs. richer (`title`, `description`, `actions`, `breadcrumb`, `sticky`). Recommendation: ship `title` + `actions` + `sticky` first; add `description` / `breadcrumb` only when a page actually needs them. Single level of nav depth today (no nested routes), so `breadcrumb` is YAGNI.
6. **Detail-page strip scope.** Confirm only `/quotes/[id]` and `/dealerships/[id]` get the key-value strip in this chunk. `/calendar` doesn't have an event-detail page today (events are dialog-edited inline). Admin pages (`/admin/people`, `/admin/lookups`) are list-only — no detail.
7. **Filter-bar scope.** Apply to `/quotes` and `/dealerships` (the two that have multi-field filtering). `/production`, `/reports`, `/admin/*` either don't filter or have simple filtering — skip unless trivially needed. Confirm.
8. **Status badge mapping.** Need to enumerate every status field the UI renders and pick a `<Badge>` variant per value:
   - Quote: `draft`, `sent`, `accepted`, `declined`, `expired` → recommendation: `draft=secondary`, `sent=default`, `accepted=success`, `declined=destructive`, `expired=outline`
   - Dealer: `prospect`, `active` → recommendation: `prospect=outline`, `active=success`
   - Booking: TBD — confirm enum from schema
   - MSA: `pending`, `active`, `expired`, `cancelled` → recommendation: `pending=secondary`, `active=success`, `expired=outline`, `cancelled=destructive`
   `<Badge>`'s shadcn defaults ship four variants (`default`, `secondary`, `destructive`, `outline`) — `success` requires a custom variant added in Phase 6. Confirm before locking.
9. **Relative timestamps.** Adopt `date-fns/formatDistanceToNow` with `<Tooltip>` carrying the absolute timestamp. Confirm `date-fns` is already a dep; if not, add in Phase 6.
10. **Sticky header z-index vs sidebar.** Sidebar is `z-30`-ish in shadcn's default; `<PageHeader sticky>` needs to sit below the sidebar but above page content. Recommendation: `z-10` for the page header, `z-20` for sidebar overlay states, defaults otherwise.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| ~~`src/components/ui/sidebar.tsx`~~ | — | Dropped — pivot 2026-05-13, no sidebar swap |
| ~~`src/components/app/app-sidebar.tsx`~~ | — | Dropped — pivot 2026-05-13, no sidebar swap |
| ~~`src/app/(app)/layout.tsx` (shell swap)~~ | — | Dropped — `AppHeader` stays as-is |
| `src/components/app/page-header.tsx` (`<PageHeader>`) | `src/components/app/app-header.tsx` (sibling) | Same layer; new shared shell component |
| `src/app/(app)/dealerships/[id]/page.tsx` (detail convention) | itself, post-Phase 4 | First detail-page convert; pattern source for `/quotes/[id]` |
| `src/app/(app)/quotes/[id]/page.tsx` (detail convention) | `src/app/(app)/dealerships/[id]/page.tsx` (post-Phase 4) | Second detail-page convert; same pattern |
| `src/app/(app)/quotes/quotes-filters.tsx` (filter-bar rework) | itself | Already extracted; reshape to standard search + dropdowns + action layout |
| `src/app/(app)/dealerships/page.tsx` (filter-bar adoption) | `src/app/(app)/quotes/quotes-filters.tsx` (post-Phase 5) | Same shape, second consumer |
| `src/components/ui/badge.tsx` (status variants) | existing post-0042 | Extend with `success` variant; map status enums |
| `docs/wiki/layout.md` | `docs/wiki/forms.md` (existing post-0042 page) | Same wiki layer; sibling convention page |

**Conventions referenced:**
- `CLAUDE.md` → wiki/designs/strategy three-folder rule; Phase 7 lands `docs/wiki/layout.md` + `log.md` entry.
- `docs/wiki/forms.md` (post-0042) — cross-link from new `layout.md` since page-level action slot and form-submission patterns intersect.
- Memory: `project_coach_owned_business.md` informs Open Question #2 (sidebar header — no workspace switcher needed for v1).

**Note:**
- Each phase includes both implementation and tests (vitest for unit-level + `web-test` for shell + page smoke).
- Phase 7 is the chunk-end full `/eval` (single Codex pass per the post-0040 `/build` cadence).
- Pivot 2026-05-13: Phase 1 (sidebar shell swap) is `Skipped`. `AppHeader` stays. Tooltip (used in Phase 6) is still needed — install with `pnpm dlx shadcn@latest add tooltip` at the start of Phase 6, or piggyback onto Phase 2 if convenient.

### Phase Checklist

#### Phase 1: shadcn Sidebar install + portal shell swap — SKIPPED (pivot 2026-05-13)
- See **Decisions locked** → "Keep the top nav". `AppHeader` is retained; no sidebar work in this chunk. If a sidebar shell is revisited, scaffold a new design folder rather than reopening this phase.

#### Phase 2: `<PageHeader>` wrapper (title + actions slot)
- [x] Build `src/components/app/page-header.tsx`: props `{ title: ReactNode, actions?: ReactNode, sticky?: boolean, description?: ReactNode }`. Title uses bold Inter (`font-sans font-bold tracking-tight text-3xl text-foreground`) post-0042. Actions slot is a flex container right-aligned. When `sticky`, the header sits in a `sticky top-16 z-10 bg-background border-b` shell (parks below the 64px `AppHeader`, not at `top-0` — see Decisions).
- [x] Unit test: renders title + actions, sticky variant gets the sticky classes (incl. `top-16`)
- [x] `tsc + test` gate green

#### Phase 3: Sweep `<PageHeader>` across all `(app)/` routes
- [x] Apply to: `/quotes` (page.tsx), `/quotes/new`, `/quotes/[id]`, `/dealerships`, `/dealerships/[id]`, `/calendar` (calendar-view top bar), `/reports`, `/production`, `/admin/people`, `/admin/lookups`, plus any other top-level `(app)/` routes
- [x] Each page loses its hand-rolled `<h1>`/action-button pair; both flow through `<PageHeader>`
- [x] Migrate every page's primary action (Save / Send / Export / Create / etc.) into the `actions` slot. ~~Replace any remaining hand-rolled `<button className="rounded-lg bg-navy …">` with shadcn `<Button>` while at it.~~ — list-page filter widgets (`QuotesFilters`, `ProductionFilters`) ride in the actions slot as-is for Phase 3; Phase 5's filter-bar convention is where they get reshaped, and Phase 6's row-action convention is where the wider hand-rolled-button sweep lands. Calendar's button cluster (Block/Book + month nav) also rides as-is for the same reason. Keeping the migration mechanical here.
- [x] Quote composer page (`/quotes/new`, `/quotes/[id]`): set `sticky` so Save/Send stays visible past the line-items table
- [x] `AppHeader` stays (pivot 2026-05-13) — do **not** delete `app-header.tsx`. Just confirm no page is double-rendering an `<h1>` that the new `<PageHeader>` already provides.
- [x] `tsc + test` gate green; `web-test` deferred to chunk-end (per post-0040 `/build` cadence — full pipeline runs once at chunk close, not per phase)

#### Phase 4: Detail-page convention (key-value strip + sections)
- [x] `/dealerships/[id]/page.tsx`: rebuild as
  - PageHeader: dealer name + status pill in actions
  - Key-value strip: `STATUS`/`MSA STATE`/`CONTACT`/`PHONE`/`EMAIL`/`ACQUIRED VIA` via `<KeyValueStrip>`
  - Sections: MSA → `<Section variant="card" title="Master Service Agreement">`; Quotes → `<Section variant="card" title="Quotes">`
- [x] `/quotes/[id]/page.tsx`: same pattern
  - Key-value strip: `STATUS`/`DEALER`/~~CAMPAIGN/EVENT START/EVENT END~~/`TOTAL` — quote rows don't carry campaign linkage or event-date fields today (no `campaignId` on the `Quote` projection; `quoteInputs` only has `audienceSize`/`eventDays` for sizing). Substituted with `AUDIENCE`/`EVENT DAYS`/`AUDIENCE SOURCE`/`TOTAL` so the strip stays useful. Campaign/event-date strip fields are a future addition gated on the Quote → Campaign FK landing (0035 Phase 7.2 / 0025 Contract phase).
  - Sections: Send history → `<Section variant="card" title="Send history">`. Quote content stays inside `QuoteComposer`. Payment status section is post-0025.
- [x] Build `src/components/app/section.tsx` (small wrapper paid off — same Section shape used on both detail pages)
- [x] `src/components/app/key-value-strip.tsx` — added (not in original anchors; tracked here)
- [x] `tsc + test` gate green; `web-test` deferred to chunk-end

#### Phase 5: List-page filter-bar convention
- [ ] Build `src/components/app/list-toolbar.tsx`: `<SearchInput>` (flex-1) + slotted filter `<Select>` dropdowns + right-anchored primary action
- [ ] `/quotes/quotes-filters.tsx`: reshape to use `<ListToolbar>`
- [ ] `/dealerships/page.tsx`: extract or add filter bar (likely a thin shell today — confirm in mid-Phase 5)
- [ ] Confirm filter state is in URL search params so back-nav from a detail restores it (Resend pattern from the conversation). If filters are component-state-only today, lift to `useSearchParams` / `router.replace`
- [ ] `tsc + test` gate green; `web-test`: filter a list, click into detail, browser-back — filters intact

#### Phase 6: Row-action convention (`<RowActions>` + shared labels/icons)
- [ ] Create `src/lib/ui/labels.ts` — `ROW_ACTION_LABELS = { view: 'View', edit: 'Edit', archive: 'Archive', activate: 'Activate', … }` as a const map. Single import site; downstream files reference `ROW_ACTION_LABELS.edit`, never the literal string.
- [ ] Create `src/lib/ui/icons.ts` — `ROW_ACTION_ICONS = { view: Eye, edit: Pencil, archive: Archive, activate: CheckCircle, … }` (lucide-react components). Same pattern — one place to change the icon used everywhere.
- [ ] Build `src/components/app/row-actions.tsx` — `<RowActions actions={[{ kind: 'view', href }, { kind: 'edit', onClick }, …]} />`. Renders the first 2–3 inline as `<Button variant="ghost" size="sm">`; everything beyond falls into a `<DropdownMenu>` (shadcn primitive — install if not already present). `aria-label` derived from action kind + row identifier so screen readers get "Edit dealer Acme Inc" without each caller hand-writing it.
- [ ] Refactor `src/app/(app)/quotes/row-actions.tsx` → use `<RowActions actions={[{ kind: 'view', href: '/quotes/' + id }]} />`. No more inline literal `View`.
- [ ] Refactor `src/app/(app)/production/row-actions.tsx` → resolve the `View + Edit` mismatch. Production rows already have a Detail dialog (`Campaign Detail`) — pick one path: either the row becomes `Edit`-only and the detail is reachable inside the edit dialog (recommended — production is a working surface, not a reading one), or split into `View → details dialog` and `Edit → form dialog` and stay consistent across all rows. Lock the choice when this phase starts.
- [ ] Refactor `src/features/dealers/dealers-columns.tsx` action cell → `<RowActions actions={[{ kind: 'view', href: '/dealerships/' + id }, { kind: 'edit', onClick }, conditional({ kind: 'activate', … }), { kind: 'archive', … }]} />`. Adds the missing `View` (since `/dealerships/[id]` exists); removes the hand-rolled `<button>` chains.
- [ ] Lint guard: add `eslint-plugins/no-inline-row-action-label.mjs` (or extend `safeparse-required`) scoped to `src/app/**/row-actions.tsx`, `src/features/**/*-columns.tsx` — flags string literals that match `/^(View|Edit|Archive|Activate|Open|Details|Manage|Show)$/` so the next contributor can't quietly re-introduce drift. Opt-out comment for the rare false positive.
- [ ] Unit tests: `<RowActions>` renders inline up to 3 actions, overflows into dropdown at 4+; `aria-label` includes the row identifier when provided.
- [ ] `tsc + test` gate green; `web-test` smoke: visit `/quotes`, `/production`, `/dealerships` — each row's action cell renders the canonical vocabulary in the documented order.

#### Phase 7: Status `<Badge>` + relative timestamps
- [ ] Extend `src/components/ui/badge.tsx` with `success` variant (green) — matches the status-green token already in `globals.css`
- [ ] Build `src/components/app/status-badge.tsx`: enum-aware wrappers `<QuoteStatusBadge>`, `<DealerStatusBadge>`, `<MsaStatusBadge>`, `<BookingStatusBadge>` so callers pass the status value and get the right variant + label
- [ ] Replace every status-as-colored-text site (`grep` `text-status-red`/`text-status-green`/`text-status-blue` plus any inline status class chains) with the appropriate badge
- [ ] Confirm `date-fns` in `package.json`; add `<RelativeTime value={Date|string} />` component that renders `formatDistanceToNow` + `<Tooltip>` with the absolute timestamp
- [ ] Replace absolute timestamps in list views (`/quotes` updated-at column, `/dealerships` last-touched, send-history rows) with `<RelativeTime>`
- [ ] Detail pages keep absolute timestamps for hard facts (event start/end, contract dates) — relative is for *recent activity*, not *scheduled events*. Confirm during sweep.
- [ ] `tsc + test` gate green

#### Phase 8: Wiki (`layout.md`) + chunk-end smoke
- [ ] Write `docs/wiki/layout.md`: portal shell anatomy (`AppHeader` top nav, retained — see pivot decision), `<PageHeader>` API + when to set `sticky` (incl. the `top-16` parking rule), detail-page key-value strip pattern (when to use, label conventions), list-page filter-bar pattern, **row-action vocabulary** (canonical labels, when to use which, where the labels constant lives, the View-xor-Edit rule), status badge + relative time conventions, capability-gated nav (preserved from `app-nav.tsx`)
- [ ] Cross-link `forms.md` ↔ `layout.md` ("page-level action slot vs. dialog footer" pointer in both directions); add `layout.md` to `docs/wiki/index.md`; append entry to `docs/wiki/log.md`
- [ ] Full `pnpm test` run — all existing tests still pass (sidebar nav tests, page-level smoke tests)
- [ ] `web-test` smoke battery: `/quotes`, `/quotes/<id>`, `/quotes/new`, `/dealerships`, `/dealerships/<id>`, `/calendar`, `/reports`, `/admin/people`. Each page renders: sidebar present, page header with title + actions visible above the fold, no remaining navy top-bar, no hand-rolled submit buttons.
- [ ] Full `/eval` at chunk-end (single Codex pass per the post-0040 `/build` cadence — fast `tsc + test` per phase, Codex + web-test + lint at chunk-end only)
