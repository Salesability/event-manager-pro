# Layout

The portal-shell convention. Every `(app)/` route renders inside the same shell and uses the same shape components — so the same conceptual surface looks and operates the same way everywhere. Established by 0043 (portal-shell + master/detail conventions); the pivot from the originally-planned shadcn Sidebar swap to "keep the top nav + ship app-wide consistency" is the load-bearing decision.

## Shell

The shell is provided by [`src/app/(app)/layout.tsx`](../../src/app/(app)/layout.tsx):

```
<AppHeader>            ← sticky top, 64px, dark navy
<main>
  {children}           ← page content, max-width 1440, padded
</main>
<Toaster />
```

`AppHeader` is **retained** (not swapped for a sidebar). The capability-gated nav lives inside it via [`app-nav.tsx`](../../src/app/(app)/app-nav.tsx) — *who sees what* is unchanged from pre-0043. Sticky-top, `z-30`. Logo links home (`/calendar`). User menu sits on the right alongside the nav items.

Any future sidebar swap is a separate chunk — 0043's spirit is consistency in operation + look-and-feel of page content, not a shell refresh.

## Page shape (the canonical surface)

Every `(app)/` page renders the same anatomy inside `<main>`:

```
<PageHeader title actions description sticky?>
[breadcrumb above the header when navigating up from a detail]
<KeyValueStrip items?>     ← detail pages
<Section variant title>    ← grouped content
…
<ListToolbar search filters actions?>   ← list pages
<DataTable columns data … />            ← the single grid primitive
```

**One grid primitive.** Every grid renders via [`<DataTable>`](../../src/components/ui/data-table.tsx) (TanStack column-defs rendered into Catalyst's `<Table>`). No raw `<table>` markup in `src/app/**` or `src/features/**` except inside form composers (the line-items table inside `quote-composer.tsx` is a form sub-element, not a row-action grid). Search lives on `<DataTable globalFilter globalFilterFn>` and pagination on `<DataTable initialPageSize>`; per-surface helpers like the old `filterQuotes`/`filterCampaigns` retired in 0050.

### `<PageHeader>` — top-of-page surface

[`src/components/app/page-header.tsx`](../../src/components/app/page-header.tsx).

Props: `{ title: ReactNode, actions?, description?, sticky? }`. Title renders bold-Inter (`font-sans font-bold tracking-tight text-3xl text-foreground`) — the post-0042 type scale.

- **Actions slot.** Page-level primary actions (Save / Send / Export / status-pill) live in the top-right of `<PageHeader>`. Hand-rolled `<h1>` + button pairs are the lint smell this fixes. Dialog actions still go in `<DialogFooter>` — that's a different concern.
- **Description on every list/grid page.** List and grid pages (`/calendar`, `/production`, `/dealerships`, `/quotes`, `/admin/people`, `/admin/lookups`, `/reports`) must pass a `description` — a one-sentence note naming the data and the filter dimensions (e.g. `"Every quote in the pipeline — drafts, sent, accepted, declined."`). It anchors the page for first-time viewers and keeps the type-scale balanced under the title. Detail pages (`/dealerships/[id]`, `/quotes/[id]`) can omit it — their identity is the record name, and the `<KeyValueStrip>` carries the at-a-glance summary.
- **Sticky on long pages only.** Set `sticky` on the quote composer (`/quotes/new`, `/quotes/[id]`) where the line-items table scrolls past the fold. Default is non-sticky to keep visual weight low.
- **Sticky parking.** When `sticky`, the header uses `sticky top-16 z-10`. `top-16` (not `top-0`) parks it just under the 64px `AppHeader`. `z-10` keeps it below the AppHeader's `z-30`.

### Breadcrumbs

When a route navigates up from a parent list (e.g. `/dealerships/[id]` → `/dealerships`), the breadcrumb sits **above** `<PageHeader>` as a small `<Link>` — not inside the header itself. Single level of depth today, so no breadcrumb component is warranted.

### `<KeyValueStrip>` — detail-page summary

[`src/components/app/key-value-strip.tsx`](../../src/components/app/key-value-strip.tsx).

A grid of uppercase-muted labels over their values. Same anatomy on every detail page so a scanner knows where to look.

- **Where used.** `/dealerships/[id]` (Status / MSA state / Contact / Phone / Email / Acquired via) and `/quotes/[id]` (Status / Dealer / Audience / Event days / Audience source / Total).
- **Label style.** `text-xs font-semibold uppercase tracking-wider text-muted-foreground`. Values are `text-sm font-medium text-foreground`, truncated.
- **What goes here.** The 4–6 facts a reader most needs at-a-glance for that record. *Not* a full data dump — sections own the rest.

### `<Section variant title actions>` — content grouping

[`src/components/app/section.tsx`](../../src/components/app/section.tsx).

Wraps grouped content under a small uppercase header. Two variants:
- `plain` (default) — bare grouping, used inline within a page.
- `card` — adds the rounded-2xl + border + soft-shadow chrome (`shadow-soft` token).

Title slot uses `text-sm font-semibold uppercase tracking-wide text-muted-foreground`. Right-side `actions` slot for section-scoped buttons (e.g. "+ New quote" inside the Quotes section on a dealer detail page).

### `<ListToolbar search filters actions>` — list-page filter shape

[`src/components/app/list-toolbar.tsx`](../../src/components/app/list-toolbar.tsx).

Standard filter-bar anatomy: flexible search slot on the left, filter pills/selects in the middle, right-anchored primary action.

- **Search state lives in URL.** Both consumers (`/quotes` via [`quotes-filters.tsx`](../../src/app/(app)/quotes/quotes-filters.tsx), `/dealerships` via [`dealers-admin.tsx`](../../src/features/dealers/dealers-admin.tsx)) push to `?q=` + `?status=` via `router.replace` with a 250ms debounce. Back-nav from a detail page restores the search term and active filter pill — the "Resend pattern".
- **Filters slot** is open-ended (pills, selects, anything that fits the page). The toolbar provides the shape, not the controls.

## Row-action vocabulary (the consistency win)

[`src/components/app/row-actions.tsx`](../../src/components/app/row-actions.tsx) renders per-row table action buttons using a **shared label + icon vocabulary** from [`src/lib/ui/labels.ts`](../../src/lib/ui/labels.ts) and [`src/lib/ui/icons.ts`](../../src/lib/ui/icons.ts).

Canonical kinds and the lucide icon for each:

| Kind | Label | Icon | When to use |
|------|-------|------|-------------|
| `edit` | Edit | `Pencil` | The default row-click destination — opens the single editable detail page for the record. Surfaces it on the identity cell, not as a separate action. |
| `archive` | Archive | `Archive` | Soft-delete state flip. Lives inside the `…` overflow menu. Pair with `tone: 'danger'`. |
| `activate` | Activate | `CheckCircle` | Prospect → active state flip. Lives inside the `…` overflow menu. Pair with `tone: 'success'`. |
| `quote` | Quote | `FilePlus` | Workflow-launch verb on dealer rows ("create a new quote against this dealer"). Lives inside the `…` overflow menu. |
| `view` | View | `Eye` | Reserved for genuinely read-only surfaces (e.g. an archived record where Edit is structurally disabled). Avoid on standard CRUD grids — the identity cell IS the View/Edit affordance. |

**Edit-default row pattern.** Row click goes to a single editable detail page; the same page renders read-only when the viewer lacks edit permission (field-level `disabled`), not as a separate `View` surface. The dotted-underline label on `<RowIdentityCell>` is the click target; Delete and any non-CRUD verbs collapse into the row-end `…` overflow menu (`<RowOverflowMenu>`). Established by 0050; replaces the prior View-xor-Edit rule.

Rationale: users are coaches/admins whose primary work is editing the document. Defaulting to a View page costs a click and a context-switch back to Edit. Collapsing View+Edit into one page makes the CRUD pattern uniform across surfaces — every list grid behaves identically (`<RowIdentityCell>` clicks through to `/<entity>/[id]`; `<RowOverflowMenu>` carries the rest).

Implications:
- Detail pages must autosave or surface an unsaved-changes guard so stray row-clicks can't strand fields mid-edit.
- Read-only display (future client-portal viewers, role-scoped users) renders the *same* page with fields disabled by role — not a separate `View` surface.
- Edit-permission scoping to authored documents is acknowledged future work.
- Detail surfaces that today render only read-only fields become editable over time; flag scope on each sweep. The dialog-edit pattern still survives on `/admin/people` and `/production` — both are next in line for the `/<entity>/[id]` promotion.

**Drift guard.** [`eslint-plugins/no-inline-row-action-label.mjs`](../../eslint-plugins/no-inline-row-action-label.mjs) lints `src/app/**/row-actions.tsx` and `src/features/**/*-columns.tsx` for inline literals matching the canonical vocabulary (`View` / `Edit` / `Archive` / `Activate` / `Open` / `Details` / `Manage` / `Show`). The constant is the single source. Per-line opt-out via `// row-label: ok`.

**Overflow primitive.** The row-end `…` button is [`<RowOverflowMenu>`](../../src/components/app/row-overflow-menu.tsx) (0050) — composes Catalyst's `<Dropdown>` / `<DropdownMenu>` / `<DropdownItem>`. Re-uses `ROW_ACTION_KINDS` / `ROW_ACTION_ICONS` / `ROW_ACTION_LABELS` from `src/lib/ui/`. Inline-button `<RowActions>` is retired on swept surfaces; it remains in tree only until the 0043 follow-up (b) sweep finishes.

**Identity-cell exceptions on `/reports`.** Every report tab renders the group/dealer label as plain text (no `<RowIdentityCell>`). Three reasons compound: (a) no detail page exists for `/coaches/[id]` or `/reports/[month]`, (b) `/reports` admits coaches via `reports:view`, but `/dealerships/[id]` gates `admin:access` — a coach clicking a dealer drill-through would route to a 403, (c) `loadDealer()` filters archived rows, so historical report dealers would 404 even for admins. The exception holds until either a coach-safe dealer surface or an archived-loader exists. Documented intentionally.

## Status badges + relative time

### `<Badge>` and the status-badge wrappers

[`src/components/ui/badge.tsx`](../../src/components/ui/badge.tsx) is a shadcn-style Badge with variants: `default` / `secondary` / `outline` / `destructive` / `success` (green, maps to `--color-status-green`) / `warning` (amber) / `info` (blue, maps to `--color-status-blue`). Always renders a `<span>` with rounded-full chrome.

[`src/components/app/status-badge.tsx`](../../src/components/app/status-badge.tsx) layers enum-aware wrappers on top so callers pass the raw status value and get the right variant + label:

- `<QuoteStatusBadge status={DisplayStatusKey}>` — `draft` (secondary) / `sent` (info) / `accepted` (success) / `declined` (destructive) / `expired` (warning).
- `<DealerStatusBadge status archivedAt>` — Archived (outline) overrides; otherwise `active` (success) / `prospect` (warning).
- `<MsaStatusBadge status={Msa['status']}>` — `pending` (warning) / `active` (success) / `expired` (outline) / `terminated` (destructive).
- `<CampaignStatusBadge live past>` — Live (success) / Past (outline) / Upcoming (info).

Status-as-colored-text (`text-status-red`/`text-status-green`/`text-status-blue` chains tacked onto `<span>`s) is the lint smell. **Use a badge wrapper.** New enum → new wrapper here, not a new inline switch.

### `<RelativeTime>` for *recent activity*; absolute for *scheduled facts*

[`src/components/app/relative-time.tsx`](../../src/components/app/relative-time.tsx). Renders a `<time dateTime title>` element with `Intl.RelativeTimeFormat` (no `date-fns` dep). Hover surfaces the absolute timestamp via the native `title` attribute.

- **Relative is for *recent activity*.** Sent timestamps on `/quotes`, created timestamps on `/quotes`, send-history rows on `/quotes/[id]`. Anything the reader cares about as "how stale is this?"
- **Absolute is for *scheduled facts*.** MSA Created / Signed / Expires dates, campaign date ranges on `/production`. Anything the reader cares about as "when does this hard fact land?"

## Capability-gated nav is preserved verbatim

Nothing in 0043 touches *who sees what*. The capability checks in `app-nav.tsx` (admin vs coach vs portal contact) continue to drive nav items inside `AppHeader`. The page convention only touches what's *inside* the content area — page header, detail-page anatomy, list-page toolbar, row actions, status display, timestamps.

## Cross-references

- [forms.md](forms.md) — page-level action slot vs. dialog footer. Save buttons in dialogs stay in `<DialogFooter>` (forms convention); page-level primary actions live in `<PageHeader actions>` (this page's convention). The two patterns don't collide; the dividing line is *which kind of submit it is*.
- `CLAUDE.md` — three-folder rule (`docs/wiki/` vs `docs/chunks/` vs `docs/strategy/`).
