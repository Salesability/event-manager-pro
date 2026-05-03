# Lookup admin — 2026-04-30

Stub for sub-plan 5.3 of `docs/designs/0004-port-migration/plan.md`. The legacy app exposes inline ⚙ Manage buttons inside the booking modal (`deprecated/index.html:377` for Event Styles, `:387` for Data Sources) that open dedicated admin modals (`manageStylesModal` lines 522–534, `manageDataSourcesModal` lines 537–549). Each modal is a simple add/remove list against a small lookup table. Done = signed-in users can add, rename, and (soft-)archive `campaign_styles` and `sales_lead_sources` rows from a dedicated UI; the booking form's selects (5.2) reflect changes immediately; existing campaigns referencing an archived lookup row keep rendering their label.

Out of scope: anything beyond these two lookups. Other lookups (statuses, etc.) stay enum-driven.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Server actions + queries for both lookups | Done | - |
| 2: Lookup admin UI (single component, two instances) | Done | - |
| 3: Wire ⚙ Manage triggers from booking form | Done | - |
| 4: Verification (tsc + vitest + dev smoke) | Done | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/schedule/actions.ts` | lookup actions near `// ---------- Lookups (5.3) ----------` | Server Actions for add/rename/archive on both lookup tables. |
| `src/features/schedule/lookup-admin.tsx` | `LookupAdmin` | Reusable client editor used by the admin route and booking dialogs. |
| `src/app/(app)/admin/lookups/page.tsx` | page root | Dedicated signed-in lookup admin page with both lookup lists. |
| `src/app/(app)/calendar/booking-form.tsx` | Event Format / Data Source fields | Inline Manage triggers and modal mounting outside the campaign form. |

**Conventions referenced:**
- `docs/wiki/conventions.md` / `CLAUDE.md` — Mutations through Server Actions.
- `docs/wiki/data-model.md` — Both lookup tables carry the `archivable` mixin; soft-delete via `archived_at` so foreign keys from `campaigns` keep resolving.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Depends on 5.1 (UI primitives + Toaster/Dialog wrappers) and 5.2 (booking form, where the inline ⚙ triggers live).
- Both lookup tables are tiny — no pagination, no search; render as a simple list with inline rename + archive.

### Phase Checklist

#### Phase 1: Server actions + queries
- [x] Add `createCampaignStyle` / `updateCampaignStyle` / `archiveCampaignStyle` to `src/features/schedule/actions.ts`.
- [x] Add `createSalesLeadSource` / `updateSalesLeadSource` / `archiveSalesLeadSource` to the same module.
- [x] Reuse `loadCampaignStyles` / `loadSalesLeadSources` (added in 5.2). If they don't exist yet, add them here.

#### Phase 2: Lookup admin UI
- [x] Build a generic `<LookupAdmin>` client component (label, list, add input, rename inline, ✕ to archive) that takes a server-action triplet as props.
- [x] Mount two instances: `/admin/event-styles` and `/admin/data-sources` (or one combined `/admin/lookups` page with two cards).

#### Phase 3: Wire ⚙ Manage from booking form
- [x] In 5.2's booking form, replace the no-op ⚙ Manage button stubs with handlers that open the lookup admin in a Dialog (or navigate to the dedicated route).

#### Phase 4: Verification
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean.
- [x] `pnpm dev` smoke: add/rename/archive both kinds of lookup; confirm booking-form selects reflect changes; confirm an existing campaign row still renders the label of an archived style.
  - Automated public smoke passed in `eval-2026-05-01-1004.md`; signed-in CRUD smoke confirmed manually.
