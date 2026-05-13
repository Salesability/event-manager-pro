# Legacy CSS token audit (Phase 1 artifact)

**Generated:** 2026-05-13 — drained by Phases 2–4.

## Token mapping (the codemod table)

| Legacy token | New (semantic) token | Notes |
|--------------|---------------------|-------|
| `text-navy` | `text-primary` | brand text → primary |
| `bg-navy` | `bg-primary` | brand fill → primary |
| `hover:bg-navy-light` | `hover:bg-primary/90` | primary-button hover |
| `bg-navy-pale` | `bg-primary/10` | today/highlight tint |
| `hover:bg-navy-pale` | `hover:bg-primary/10` | row hover |
| `hover:bg-navy-pale/40` | `hover:bg-primary/5` | even subtler row hover |
| `bg-navy-pale/60` | `bg-primary/5` | dim today tint variant |
| `text-stone-400` | `text-muted-foreground/70` | lowest-contrast muted text |
| `text-stone-500` | `text-muted-foreground` | muted text |
| `text-stone-600` | `text-muted-foreground` | muted text |
| `text-stone-700` | `text-foreground` | body text |
| `text-stone-800` | `text-foreground` | body text (heading-ish) |
| `border-stone-100` | `border-border` | hairline divider |
| `border-stone-200` | `border-border` | hairline chrome (most common) |
| `border-stone-300` | `border-input` | form-field border |
| `hover:border-stone-400` | `hover:border-input` | form-field hover |
| `bg-stone-50` | `bg-muted` | subtle surface |
| `bg-stone-100` | `bg-muted` | subtle surface |
| `bg-stone-200` | `bg-muted` | pill / track |
| `bg-stone-400` | `bg-muted-foreground` | avatar dot (high contrast on white) |
| `bg-cream` | `bg-background` | full-page off-white → white |
| `accent-light` | — | unused in `src/`; drop from `:root` |
| `font-display` | `font-sans font-bold tracking-tight` | drop alias when callsites = 0 |

`text-accent` and `bg-accent` are **kept** — they resolve to `--accent` / `--accent-foreground` via the shadcn aliasing in `globals.css`. They're not legacy.

## File classification

Three buckets:
- **CS** — class-swap (mechanical token replacement only)
- **COMP** — component-swap (hand-rolled button/badge cluster → shadcn primitive)
- **FD** — `font-display` callsite (folded into Phase 3)

### `src/app/(app)/*` — feature pages

| File | Classes hit | Bucket |
|------|-------------|--------|
| `calendar/booking-form.tsx` | `bg-navy`, `text-navy`, `border-stone-200`, `bg-stone-100`, `text-stone-600`, `hover:bg-navy-light`, `hover:border-stone-400` | CS |
| `calendar/calendar-view.tsx` | `text-navy`, `bg-navy`, `bg-navy-pale`, `hover:bg-navy-pale`, `bg-stone-100`, `bg-stone-200`, `text-stone-400/600/800`, `border-stone-200`, `font-display` (×2) | CS + FD |
| `calendar/event-detail.tsx` | `text-navy`, `bg-navy`, `hover:bg-navy-pale`, `hover:bg-navy-light`, `border-stone-200`, `bg-stone-200`, `text-stone-500/600/800` | CS |
| `dealerships/[id]/page.tsx` | `text-navy`, `bg-navy`, `text-stone-400/500/600/700/800`, `border-stone-200` | CS |
| `production/page.tsx` | `text-navy`, `bg-navy`, `hover:bg-navy-pale`, `text-stone-400/600/800`, `border-stone-200` | CS |
| `production/production-filters.tsx` | `text-navy`, `text-stone-400/600/700/800`, `border-stone-200` | CS |
| `quotes/[id]/page.tsx` | `text-navy`, `text-stone-500/600/700/800`, `border-stone-200`, `bg-stone-200` | CS |
| `quotes/page.tsx` | `bg-navy`, `hover:bg-navy-pale/40`, `text-stone-400/600/800`, `border-stone-200` | CS |
| `quotes/quotes-filters.tsx` | `text-navy`, `text-stone-400/600/800`, `border-stone-200` | CS |
| `reports/page.tsx` | `border-stone-200` only | CS |

### `src/features/*` — feature modules

| File | Classes hit | Bucket |
|------|-------------|--------|
| `dealers/dealer-form.tsx` | `bg-navy`, `text-navy`, `hover:bg-navy-light`, `border-stone-200`, `text-stone-600` | CS |
| `dealers/dealers-admin.tsx` | `text-navy`, `text-stone-500/600/800`, `border-stone-200` | CS |
| `dealers/dealers-columns.tsx` | `text-navy`, `text-stone-400/500/600/700/800` | CS |
| `msa/msa-create-dialog.tsx` | `text-navy`, `text-stone-500/700/800`, `border-stone-300` | CS |
| `people/orphan-auth-users.tsx` | `bg-navy`, `text-navy`, `hover:bg-navy-light`, `border-stone-200`, `text-stone-500/600/800`, `font-display` (text-amber-900 — kept, not legacy) | CS + FD |
| `people/people-admin.tsx` | `bg-navy`, `text-navy`, `hover:bg-navy-light`, `border-stone-200/300`, `bg-stone-50`, `text-stone-500/600/700/800`, **hand-rolled button cluster** (3 buttons + 1 checkbox-styled span), **hand-rolled badge** | CS + **COMP** |
| `people/people-columns.tsx` | `text-navy`, `bg-navy`, `text-stone-400/600/800`, `bg-stone-100`, `bg-stone-200` | CS |
| `quotes/quote-composer.tsx` | `bg-navy`, `text-navy`, `hover:bg-navy-light`, `border-stone-200/300`, `bg-stone-50`, `text-stone-400/500/600/700/800`, `font-display` (×3), **hand-rolled button cluster** (3 buttons) | CS + COMP + FD |
| `quotes/status-display.ts` | `text-stone-600`, `bg-stone-200` (inside `STATUS_PILL_CLS` — already parked as 0043 follow-up (d) for retirement; the codemod here changes nothing if (d) lands first, otherwise migrates the strings) | CS |
| `reports/reports-columns.tsx` | `text-navy`, `text-stone-400/800` | CS |
| `reports/reports-tabs.tsx` | `text-navy`, `text-stone-600/700/800`, `border-stone-200` | CS |
| `schedule/availability-admin.tsx` | `bg-navy`, `text-navy`, `hover:bg-navy-light`, `bg-stone-50`, `bg-stone-100`, `text-stone-400/500/600/700/800`, `border-stone-200` | CS |
| `schedule/lookup-admin.tsx` | `bg-navy`, `bg-navy-pale`, `text-navy`, `hover:bg-navy-light`, `bg-stone-50`, `text-stone-500/700/800`, `border-stone-200`, `font-display` | CS + FD |
| `services/services-admin.tsx` | `bg-navy`, `bg-navy-pale`, `text-navy`, `hover:bg-navy-light`, `bg-stone-50`, `bg-stone-100`, `border-stone-100/200`, `text-stone-500/600/700/800`, `font-display` | CS + FD |

### `src/components/app/*` and `src/components/ui/*` — modernized-tree stragglers

| File | Classes hit | Bucket |
|------|-------------|--------|
| `app/app-header.tsx` | `bg-navy` (one mobile-menu hover) | CS |
| `app/app-nav.tsx` | `text-navy`, `bg-stone-100`, `bg-stone-400`, `border-stone-200`, `text-stone-700` | CS |
| `app/user-menu.tsx` | `text-navy`, `bg-stone-200`, `bg-stone-400`, `border-stone-200`, `text-stone-400/700` | CS |
| `ui/data-table.tsx` | `text-navy`, `border-stone-200`, `text-stone-500/600` | CS |
| `ui/toaster.tsx` | `text-navy`, `border-stone-200`, `text-stone-600` | CS |

### Coach-shared public surfaces

| File | Classes hit | Bucket | Decision |
|------|-------------|--------|----------|
| `app/login/page.tsx` | `bg-cream`, `bg-navy`, `hover:bg-navy-light`, `border-stone-200`, `bg-stone-200`, `text-stone-400/600/800` | CS | **Migrate.** The logo blue is already `--primary` (`#1a5fa8`), so `bg-primary` keeps brand. `bg-cream` is a legacy off-white the modern aesthetic doesn't lean on — flip to `bg-background` (white). |
| `app/share/coach/[id]/page.tsx` | `bg-cream`, `bg-navy` (×1 each) | CS | **Migrate.** Same reasoning. |

No "keep-brand-as-named-token" exceptions: every callsite migrates. The named brand tokens stay defined inside `globals.css` (the source-of-truth `--color-brand-blue` etc. that `--primary` resolves to) — they just stop being **read from** by Tailwind utility classes.

## Out-of-scope falsely-flagged files

These files surfaced in the ripgrep but use **kept** semantic tokens (`bg-accent` / `text-accent` resolve via shadcn aliasing):

- `src/components/app/row-actions.tsx` — `border-accent/40`, `bg-accent/10`, `text-accent` (kept)
- `src/components/ui/combobox.tsx` — `data-highlighted:bg-accent` (shadcn primitive — kept)
- `src/components/ui/select.tsx` — `focus:bg-accent` (shadcn primitive — kept)
- `src/features/msa/msa-panel.tsx` — `border-accent/40`, `bg-accent/10`, `text-accent` (kept)

No edits to these in this chunk.

## Volume summary

- **31 files** with real legacy-token usage (after dropping the four kept-accent files).
- **3 component-swap callsites**: `people-admin.tsx` (button cluster + badge), `quote-composer.tsx` (button cluster).
- **8 `font-display` callsites** (Phase 1's "~16" estimate was high; current count is 8).
- **`accent-light`** appears in `globals.css` only — zero callsites. Drop from `:root` in Phase 4.

## Phase-2 sweep order

Smallest blast radius first, alphabetical within each grouping:

1. `src/app/(app)/reports/page.tsx` (1 token, 1 line — warm-up)
2. `src/app/(app)/quotes/quotes-filters.tsx` and `src/app/(app)/production/production-filters.tsx` (filter chrome)
3. `src/app/(app)/quotes/page.tsx`, `src/app/(app)/production/page.tsx` (list pages)
4. `src/app/(app)/dealerships/[id]/page.tsx`, `src/app/(app)/quotes/[id]/page.tsx` (detail pages)
5. `src/app/(app)/calendar/*` (calendar surfaces — heaviest in `(app)/`)
6. `src/features/dealers/*` then `src/features/reports/*` then `src/features/msa/*` then `src/features/schedule/*` then `src/features/services/*` then `src/features/people/*` (defer the component-swap files to Phase 3)
7. `src/features/quotes/status-display.ts` (alone — tiny module)
8. `src/components/app/*` and `src/components/ui/*` stragglers (5 files)
9. Coach-shared public surfaces (`login`, `share/coach/[id]`)

`src/features/quotes/quote-composer.tsx` and `src/features/people/people-admin.tsx` are class-swapped in Phase 2 for the surrounding chrome, but their hand-rolled button/badge clusters are component-swapped in Phase 3.
