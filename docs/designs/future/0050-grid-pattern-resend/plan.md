# Grid pattern — Resend-style row identity + overflow actions

**Started:** _Not started — deferred_

> **Deferred 2026-05-13.** This chunk **starts after `0049-tailwind-catalyst-migration` lands**. The catalyst migration is expected to reshape both `src/components/ui/data-table.tsx` and `src/components/app/row-actions.tsx` (the two primitives this chunk extends), so anchors and class vocabulary below are tentative — re-audit on un-defer.
>
> **Un-defer trigger:** `0049-tailwind-catalyst-migration` flipped to Done and moved into `closed/`. On un-defer, move this folder back to top-level via `mv docs/designs/future/0050-grid-pattern-resend docs/designs/0050-grid-pattern-resend` + reverse the cross-ref sweep (CLAUDE.md → "Un-deferring").

## Visual target

Reference screenshots in this folder ([`resend-row-with-overflow.png`](resend-row-with-overflow.png), [`resend-row-action-menu.png`](resend-row-action-menu.png)) — Resend's API-keys table is the model. Cues to copy:

1. **Identity cell — leading icon avatar + dotted-underline label.** The row's primary identifier (e.g. "Onboarding") renders with a small rounded-square tinted icon to its left and a *dotted* underline on the text. The underline communicates "click to view" without the visual heaviness of a solid blue link. The whole label is the View affordance.
2. **Opaque-value pill.** Token-shaped columns (`re_5wj99ctm…`) render as a pill: light gray background, monospace, truncated with ellipsis, fixed width.
3. **Semantic value column.** Plain text like permission ("Sending access"), relative time ("1 day ago", "12 days ago") — no chrome, just typography.
4. **Row-end `…` overflow menu.** All per-row actions collapse into a single trailing `…` button. Clicking opens a popover with icon + label rows. Destructive actions (`Delete API key`) render in destructive-red with a trash icon. The current inline-button-row shape is retired on adopted surfaces.
5. **Airy rows.** Generous vertical padding, very subtle 1px dividers, gray-50 header background. Comparable to today's `<DataTable>` but with more whitespace.
6. **Footer chrome.** `Page 1 – 1 of 1 keys – 40 items ▾` — pagination shown as plain prose with a page-size disclosure caret. Match in spirit; exact shape can stay close to today's pagination block.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Post-0049 audit + lead-surface pick | Pending | - |
| 2: Identity-cell primitive (icon + dotted-underline View link) | Pending | - |
| 3: Overflow-menu row-actions primitive | Pending | - |
| 4: Token-pill + footer-chrome polish | Pending | - |
| 5: Sweep representative grids + smoke verification | Pending | - |

The app's tables today render row actions as an inline button row (`<RowActions>`) and primary identifiers as solid `<Link>` text. The Resend pattern moves to **icon + dotted-underline identity** and **`…` overflow menu** for actions — denser-feeling rows with cleaner row-end chrome. "Done" is: at least three representative surfaces (`/quotes`, `/dealerships`, `/admin/people`) using the new identity-cell + overflow-menu shape; the old inline-button row shape removed from those surfaces; visual-smoke screenshots in the eval report.

## Code Anchors

> **All anchors below are tentative** — the `0049-tailwind-catalyst-migration` chunk likely reshapes `data-table.tsx` and `row-actions.tsx` into Catalyst's Table+TableActions vocabulary. Re-audit anchors on un-defer.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/components/app/row-overflow-menu.tsx` — `…` trigger + popover with icon+label rows, destructive-red variant | `src/components/app/row-actions.tsx:1-50` | Same layer (app-level composable), same vocabulary surface (`RowActionKind` + `ROW_ACTION_ICONS` + `ROW_ACTION_LABELS`), replaces inline-row rendering with popover-menu rendering — re-use the kind/icon/label maps unchanged |
| `src/components/app/row-identity-cell.tsx` — leading-icon slot + dotted-underline `<Link>` | `src/components/app/page-header.tsx` (chrome composability shape) + `src/components/ui/data-table.tsx:30-60` (column-def consumer) | New primitive but composes existing chrome; reads as a row-cell counterpart to `<PageHeader>`'s identity block |
| `src/components/ui/token-pill.tsx` — monospace truncated chip | `src/components/app/status-badge.tsx` (badge shape primitive) | Same chip-shape vocabulary; differs only in monospace font + truncation behavior |
| Extend `<DataTable>` (or its 0049 successor) — accept identity-cell column + overflow-actions column as first-class column types | `src/components/ui/data-table.tsx:30-60` | The column-def shape is where the new cell types plug in; keep `ColumnDef<TData, TValue>` boundary intact |
| Sweep `/quotes` columns | `src/features/quotes/quote-columns.tsx` (post-0049 path) | Lead surface — highest-traffic table; sets the pattern other features mirror |
| Sweep `/dealerships` + `/admin/people` columns | `src/features/dealerships/dealership-columns.tsx`, `src/features/people/people-columns.tsx` | Second + third representative — different identity-cell shapes (dealer name+address, person name+role) exercise the slot's flexibility |

**Conventions referenced:**
- `docs/wiki/layout.md` — View-xor-Edit rule. Dotted-underline label is the View affordance; the `…` menu's `Edit` entry is the Edit affordance. The same row no longer offers both via separate visible buttons.
- `docs/wiki/<ui-tables-or-whatever-0049-adds>.md` — populate on un-defer with whatever convention page 0049 leaves behind.

**Overall Progress:** 0% (0/5 phases complete) — deferred

**Note:**
- Each phase includes both implementation and tests
- Visual diff (screenshot capture) carries more weight than integration tests for this chunk; assert structural shape in unit tests (e.g. "overflow trigger renders with aria-label X; clicking opens popover with N items") rather than pixel layouts

### Phase Checklist

#### Phase 1: Post-0049 audit + lead-surface pick
- [ ] Re-walk `src/components/ui/data-table.tsx` and `src/components/app/row-actions.tsx` to see what 0049 left behind — primitive names, vocabulary maps, column-def shape. Update the Code Anchors table above before any code lands.
- [ ] Pick the lead surface to onboard first (default: `/quotes`). Confirm the row schema has fields for: identity label, leading icon (or null), one opaque pill value (or null), 2–4 semantic columns, 1–4 row actions.
- [ ] Confirm the dotted-underline / `…` / pill shapes can land within whatever Catalyst-shadcn primitives 0049 ships — if they can't, note the gap as a v2 follow-up rather than re-fighting the migration's choices.

#### Phase 2: Identity-cell primitive
- [ ] Add `src/components/app/row-identity-cell.tsx` — props: `{ icon?: ReactNode; iconTone?: 'green'|'blue'|'amber'|'stone'; label: string; href: string; sublabel?: string }`. Renders rounded-square tinted icon + dotted-underline label + optional sublabel below.
- [ ] Dotted-underline class composition (tentative — refine post-0049): `underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 hover:decoration-foreground`. Verify against Catalyst's Link variants once 0049 ships.
- [ ] Unit test: render with + without icon, with + without sublabel, assert label is wrapped in a single `<Link>` to the supplied `href`.

#### Phase 3: Overflow-menu row-actions primitive
- [ ] Add `src/components/app/row-overflow-menu.tsx` — props: `{ actions: ReadonlyArray<RowAction | null | false>; ariaSuffix?: string }`. Renders a single `…` icon button as trigger; opens a popover (Radix or Catalyst dropdown — match 0049's primitive) with one row per action: icon + label + destructive-red coloring when `tone === 'danger'`.
- [ ] Re-use `ROW_ACTION_ICONS` / `ROW_ACTION_LABELS` / `RowActionKind` from `src/lib/ui/{icons,labels}.ts` — the vocabulary maps stay; only the rendering layer changes.
- [ ] Lint rule audit: `eslint-plugins/no-inline-row-action-label.mjs` may need a parallel `prefer-row-overflow-menu` rule that flags `<RowActions>` usage inside columns files where the new overflow shape should be used. Decide after Phase 5 whether to add or punt.
- [ ] Unit test: render with mixed link/button actions including one `tone='danger'`; assert trigger has `aria-label="Open row actions${ariaSuffix}"`, popover content lists actions in order, destructive item has the red color class.

#### Phase 4: Token-pill + footer-chrome polish
- [ ] Add `src/components/ui/token-pill.tsx` — props: `{ value: string; maxChars?: number }`. Renders monospace pill with `bg-muted text-muted-foreground rounded-md px-2 py-0.5 font-mono text-sm` (refine post-0049); truncates to `maxChars` with trailing `…`. Used today for short opaque ids only; not a sweep target.
- [ ] Footer chrome — match the "Page X – Y of Z keys – N items ▾" prose shape. Today's DataTable pagination block is the reference point; goal is a smaller-feeling, prose-shaped footer rather than a full Pagination component. Punt if Catalyst's table already ships the right shape.

#### Phase 5: Sweep representative grids + smoke verification
- [ ] `/quotes` columns: identity column → `<RowIdentityCell>` (icon: small `quote` glyph, label: `quoteDisplayName(createdAt)` from [`closed/0048-quote-timestamp-naming`](../../closed/0048-quote-timestamp-naming/plan.md) if shipped, href: `/quotes/[id]`). Inline `<RowActions>` → `<RowOverflowMenu>`.
- [ ] `/dealerships` columns: identity column → `<RowIdentityCell>` (icon: small `dealership` glyph, label: dealer name, sublabel: city/region, href: `/dealerships/[id]`). Inline `<RowActions>` → `<RowOverflowMenu>`.
- [ ] `/admin/people` columns: identity column → `<RowIdentityCell>` (icon: small `person` glyph or initials avatar, label: full name, sublabel: role, href: `/admin/people/[id]`). Inline `<RowActions>` → `<RowOverflowMenu>`.
- [ ] Smoke (web-test): `goto /quotes`; expect first row's identity cell to have a dotted-underline label + leading icon; click `…` trigger on row; expect popover with `Edit` and `Delete` (or chunk-appropriate actions); `Delete` styled in destructive-red.
- [ ] Smoke (web-test): same shape verification on `/dealerships` and `/admin/people`.
- [ ] Visual smoke (manual): capture a side-by-side screenshot of `/quotes` before-and-after; attach to eval report.
- [ ] Codex pass: feed the new primitives + 3 swept columns files to Codex; specifically ask whether the dotted-underline shape (a non-standard link affordance) is accessible — keyboard + screen-reader semantics on the cell-wide click target.
