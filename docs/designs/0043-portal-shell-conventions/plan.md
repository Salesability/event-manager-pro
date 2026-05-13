# Portal shell + master/detail conventions

**Started:** 2026-05-13
**Status:** Scaffolded — Parked (un-park trigger: 0042 ships, i.e. Phase 7 Done + chunk closed). Builds directly on 0042's shadcn baseline; running both in parallel collides on `src/app/(app)/layout.tsx` and on every page header.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: shadcn Sidebar install + portal shell swap | Pending | - |
| 2: `<PageHeader>` wrapper (title + actions slot) | Pending | - |
| 3: Sweep `<PageHeader>` across all `(app)/` routes | Pending | - |
| 4: Detail-page convention (key-value strip + sections) | Pending | - |
| 5: List-page filter-bar convention | Pending | - |
| 6: Status `<Badge>` + relative timestamps | Pending | - |
| 7: Wiki (`layout.md`) + chunk-end smoke | Pending | - |

Shift the portal shell from a top-header layout to a shadcn-Sidebar-based layout, and establish three reusable conventions (page header with top-right action slot, detail-page key-value strip + sections, list-page filter-bar shape) so every screen in the staff app has the same structure. Specific user pain points this addresses: (1) primary actions hidden below the fold on long pages — they move to a persistent top-right slot in `<PageHeader>`; (2) hand-rolled submit buttons with copy-pasted Tailwind chains across `lookup-admin.tsx`, `availability-admin.tsx`, `services-admin.tsx`, `booking-form.tsx`, `dealer-form.tsx`, `people-admin.tsx`, `orphan-auth-users.tsx` — all migrate to shadcn `<Button>` (already installed via 0042 Phase 2). Done = (a) `AppHeader` replaced by `<SidebarProvider>` + `<AppSidebar>` with identical nav items + capability gates preserved; (b) `<PageHeader title actions sticky?>` wrapper applied to every `(app)/` route; (c) `/quotes/[id]` and `/dealerships/[id]` adopt the icon → object → identifier → key-value strip → sections pattern; (d) `/quotes` and `/dealerships` adopt the standardized filter bar (search-flex → fixed dropdowns → action-right); (e) `<Badge>` variants map to every status enum currently rendered as colored text; (f) `docs/wiki/layout.md` captures the convention and is cross-linked from `index.md` + `forms.md`.

**Overall Progress:** 0% (0/7 phases complete)

## Decisions locked

- **Action-slot placement.** Page-level primary actions live in **`<PageHeader actions>`** (top-right of content area), never at the bottom of a scrolling page. Dialog actions stay in `DialogFooter` (bottom) — that's canonical dialog UX and not in scope here.
- **Sticky page header on long pages only.** `<PageHeader sticky>` opts in; default is non-sticky. Quote composer is the clearest candidate (line-items table can scroll past the fold). Most pages don't need sticky and the gain isn't worth the visual weight.
- **No top header.** The portal becomes sidebar-only, matching the modern-minimal aesthetic 0042 locked in. The existing `AppHeader` (`bg-navy`, sticky, 64px) is fully removed in Phase 1.
- **Capability-gated nav preserved verbatim.** Whatever `app-nav.tsx` currently shows/hides based on roles + capabilities continues to do so inside `<AppSidebar>`. This chunk does not change *who sees what*, only *what the shell looks like*.

## Open Questions

The Phase 1 implementation needs answers before files start moving.

1. **Sidebar collapse mode.** Three shadcn options: `offcanvas` (sheet-style, fully hidden when collapsed), `icon` (icon-only rail, expand on hover/click), `none` (always full width). Recommendation: `icon` — preserves nav affordance on narrow widescreens, matches Resend/Vercel/Linear pattern.
2. **Sidebar header content.** Resend uses a workspace switcher; Vercel uses the team picker. This app is **single-tenant** — coaches conceptually run their own business inside the shared system but don't switch tenants/workspaces (per memory: `project_coach_owned_business.md`). Options: (A) static SaleDay logo (no switcher — there's nothing to switch); (B) coach-name chip showing "Viewing: <coach>" for admin/staff who can scope across coaches' work; (C) workspace switcher placeholder for v2 multi-org. Recommendation: (A) for v1 — simplest, no new auth logic, accurate to the single-tenant model.
3. **Sidebar footer content.** Currently the top-header carries `user.email` + admin badge. Move to sidebar footer? Or sidebar-header upper-left + footer reserved for collapse trigger? Recommendation: footer with avatar + email + `DropdownMenu` for sign-out, matching shadcn's standard sidebar pattern.
4. **Mobile breakpoint.** shadcn sidebar auto-switches to `Sheet` on mobile (`<md` by default). Confirm `md` (768px) is the right breakpoint for this app — staff use laptops mostly; the calendar view is the only mobile-likely surface. Probably fine as default.
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
| `src/components/ui/sidebar.tsx` (shadcn install) | `src/components/ui/dialog.tsx` (existing shadcn primitive) | Same file location, same export pattern post-0042 |
| `src/components/app/app-sidebar.tsx` (composed sidebar) | `src/components/app/app-header.tsx:11` (current shell) | Same layer (`components/app/*`) — composed app-shell parts |
| `src/app/(app)/layout.tsx` (shell swap) | itself (current `<AppHeader>` wrapper) | Same file, replace the wrapper |
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
- 0042 must be fully closed before this chunk un-parks. Specifically Phase 7 of 0042 (smoke) must be Done and the chunk moved to `closed/` — otherwise Phase 1 of this chunk fights `globals.css`/layout edits with 0042's tail.

### Phase Checklist

#### Phase 1: shadcn Sidebar install + portal shell swap
- [ ] Answer the open questions (lock collapse mode, sidebar header/footer content, mobile breakpoint, page-header API shape)
- [ ] `pnpm dlx shadcn@latest add sidebar sheet tooltip` (Sidebar uses Sheet on mobile; Tooltip used in Phase 6 — install together)
- [ ] Build `src/components/app/app-sidebar.tsx`: composed `<Sidebar>` with `<SidebarHeader>` (logo), `<SidebarContent>` (nav items via the existing `app-nav.tsx` source-of-truth), `<SidebarFooter>` (user dropdown)
- [ ] Preserve capability-gated nav items 1:1 — same items, same gates, same hrefs
- [ ] Replace `src/app/(app)/layout.tsx`: wrap children in `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>` containing the main content area
- [ ] Delete `src/components/app/app-header.tsx` only after Phase 3 confirms no remaining imports
- [ ] `tsc + test` gate green; `web-test` smoke: sidebar renders + collapses + nav items visible at expected breakpoints

#### Phase 2: `<PageHeader>` wrapper (title + actions slot)
- [ ] Build `src/components/app/page-header.tsx`: props `{ title: ReactNode, actions?: ReactNode, sticky?: boolean, description?: ReactNode }`. Title uses bold Inter (`font-sans font-bold tracking-tight text-3xl text-foreground`) post-0042. Actions slot is a flex container right-aligned. When `sticky`, the header sits in a `sticky top-0 z-10 bg-background border-b -mx-8 px-8` shell so it spans the inset's gutter.
- [ ] Unit test: renders title + actions, sticky variant gets the sticky classes
- [ ] `tsc + test` gate green

#### Phase 3: Sweep `<PageHeader>` across all `(app)/` routes
- [ ] Apply to: `/quotes` (page.tsx), `/quotes/new`, `/quotes/[id]`, `/dealerships`, `/dealerships/[id]`, `/calendar` (calendar-view top bar), `/reports`, `/production`, `/admin/people`, `/admin/lookups`, plus any other top-level `(app)/` routes
- [ ] Each page loses its hand-rolled `<h1>`/action-button pair; both flow through `<PageHeader>`
- [ ] Migrate every page's primary action (Save / Send / Export / Create / etc.) into the `actions` slot. Replace any remaining hand-rolled `<button className="rounded-lg bg-navy …">` with shadcn `<Button>` while at it.
- [ ] Quote composer page (`/quotes/new`, `/quotes/[id]`): set `sticky` so Save/Send stays visible past the line-items table
- [ ] Delete `app-header.tsx` once `git grep` confirms no consumers
- [ ] `tsc + test` gate green; `web-test`: spot-check 4-5 pages to confirm consistent header layout

#### Phase 4: Detail-page convention (key-value strip + sections)
- [ ] `/dealerships/[id]/page.tsx`: rebuild as
  - PageHeader: `<icon-of-dealer> <name>` + actions (Edit, Send MSA, etc.)
  - Key-value strip: `STATUS`/`MSA STATE`/`CONTACT`/`PHONE`/`EMAIL`/`ACQUIRED VIA` in a grid (uppercase muted `text-xs uppercase tracking-wider text-muted-foreground` labels)
  - Sections: existing MSA card → `<Section title="Master Service Agreement">`; existing Quotes list → `<Section title="Quotes">`
- [ ] `/quotes/[id]/page.tsx`: same pattern
  - Key-value strip: `STATUS`/`DEALER`/`CAMPAIGN`/`EVENT START`/`EVENT END`/`TOTAL`
  - Sections: Quote content, Send history (post-0040), Payment status (when 0025 lands)
- [ ] Build `src/components/app/section.tsx` if a small wrapper feels worth it (`<section className="space-y-3"><h2 className="text-sm font-semibold tracking-tight">{title}</h2>{children}</section>`); otherwise inline
- [ ] `tsc + test` gate green; `web-test`: visit one dealer detail + one quote detail

#### Phase 5: List-page filter-bar convention
- [ ] Build `src/components/app/list-toolbar.tsx`: `<SearchInput>` (flex-1) + slotted filter `<Select>` dropdowns + right-anchored primary action
- [ ] `/quotes/quotes-filters.tsx`: reshape to use `<ListToolbar>`
- [ ] `/dealerships/page.tsx`: extract or add filter bar (likely a thin shell today — confirm in mid-Phase 5)
- [ ] Confirm filter state is in URL search params so back-nav from a detail restores it (Resend pattern from the conversation). If filters are component-state-only today, lift to `useSearchParams` / `router.replace`
- [ ] `tsc + test` gate green; `web-test`: filter a list, click into detail, browser-back — filters intact

#### Phase 6: Status `<Badge>` + relative timestamps
- [ ] Extend `src/components/ui/badge.tsx` with `success` variant (green) — matches the status-green token already in `globals.css`
- [ ] Build `src/components/app/status-badge.tsx`: enum-aware wrappers `<QuoteStatusBadge>`, `<DealerStatusBadge>`, `<MsaStatusBadge>`, `<BookingStatusBadge>` so callers pass the status value and get the right variant + label
- [ ] Replace every status-as-colored-text site (`grep` `text-status-red`/`text-status-green`/`text-status-blue` plus any inline status class chains) with the appropriate badge
- [ ] Confirm `date-fns` in `package.json`; add `<RelativeTime value={Date|string} />` component that renders `formatDistanceToNow` + `<Tooltip>` with the absolute timestamp
- [ ] Replace absolute timestamps in list views (`/quotes` updated-at column, `/dealerships` last-touched, send-history rows) with `<RelativeTime>`
- [ ] Detail pages keep absolute timestamps for hard facts (event start/end, contract dates) — relative is for *recent activity*, not *scheduled events*. Confirm during sweep.
- [ ] `tsc + test` gate green

#### Phase 7: Wiki (`layout.md`) + chunk-end smoke
- [ ] Write `docs/wiki/layout.md`: portal shell anatomy (Sidebar + Inset), `<PageHeader>` API + when to set `sticky`, detail-page key-value strip pattern (when to use, label conventions), list-page filter-bar pattern, status badge + relative time conventions, capability-gated nav (preserved from app-nav)
- [ ] Cross-link `forms.md` ↔ `layout.md` ("page-level action slot vs. dialog footer" pointer in both directions); add `layout.md` to `docs/wiki/index.md`; append entry to `docs/wiki/log.md`
- [ ] Full `pnpm test` run — all existing tests still pass (sidebar nav tests, page-level smoke tests)
- [ ] `web-test` smoke battery: `/quotes`, `/quotes/<id>`, `/quotes/new`, `/dealerships`, `/dealerships/<id>`, `/calendar`, `/reports`, `/admin/people`. Each page renders: sidebar present, page header with title + actions visible above the fold, no remaining navy top-bar, no hand-rolled submit buttons.
- [ ] Full `/eval` at chunk-end (single Codex pass per the post-0040 `/build` cadence — fast `tsc + test` per phase, Codex + web-test + lint at chunk-end only)
