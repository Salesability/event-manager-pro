# Drain the legacy CSS token layer

**Started:** 2026-05-13

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Audit + classification table | Done | `f510218` |
| 2: Class-swap codemod sweep (`stone-*`, `navy`, `cream`, `accent-*`) | Done | `1166391`, `eea89f2`, `8a22e72` |
| 3: Component-swap sweep (hand-rolled buttons/badges → shadcn primitives) + `font-display` retirement | Done | `62dcbe4` |
| 4: Delete legacy block from `globals.css` + assert no orphaned refs | Done | `dbbce7e` |
| 5: Smoke + Codex eval | Pending | - |

This chunk finishes the migration that `0042 Phase 1` started. shadcn `init` (May 12) rewired `src/components/ui/` and `src/components/app/` onto semantic tokens (`--primary`, `--muted`, `--foreground`, `--border`), but the **feature pages and feature modules** — ported earlier in the April 30 – May 3 window — were left on the legacy brand-named tokens (`text-navy`, `bg-cream`, `text-stone-*`, `font-display`). The two layers coexist today only because `globals.css` keeps both blocks defined (the "strategy A" two-layer aliasing). "Done" is: every file under `src/features/*` and `src/app/(app)/*` reads from semantic tokens, the legacy brand block can be removed from `globals.css` without breaking anything, and `globals.css` is the single source of truth for color and typography decisions. This naturally unblocks the design-chroma north-star (`docs/wiki/index.md` → palette work) — once `text-primary` flows from `--primary`, retheming the app is one CSS edit instead of a thirty-file sweep.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape. This is a sweep, so the anchors are the **already-migrated reference shapes** — files the builder should make the un-migrated files *look like*.

| Work | Anchor (`path:line`) | Why this anchor |
|------|---------------------|-----------------|
| Class swaps in feature pages (`src/app/(app)/*`) | `src/components/app/page-header.tsx:27` | Canonical shape for surface chrome — `border-border bg-background`, `text-foreground`, `text-muted-foreground`, `font-sans text-3xl font-bold tracking-tight` (the `font-display` replacement called for in `globals.css` lines 22–26) |
| Class swaps in feature modules (`src/features/*`) | `src/components/app/key-value-strip.tsx`, `src/components/app/section.tsx` | Same token vocabulary applied to denser, list-detail surfaces |
| Hand-rolled button replacements (e.g. `quote-composer.tsx:379–399`, `people-admin.tsx:119–134`) | `src/components/ui/button.tsx:8–35` (the cva variants) | The canonical Button cva map — `default` for primary actions, `outline` for secondary, `ghost` for tertiary. Hand-rolled `rounded-lg bg-navy …` clusters become `<Button variant="default">`; `rounded border border-stone-200 …` clusters become `<Button variant="outline" size="sm">` |
| Hand-rolled badge/pill replacements (e.g. `people-admin.tsx:157`) | `src/components/ui/badge.tsx` (cva variants `success`/`warning`/`info`) | Already used by `<PersonLifecycleBadge>`/`<QuoteStatusBadge>` siblings — keep all status chrome behind the same primitive |
| `font-display` retirement | The locked decision in `src/app/globals.css:22–26` | `font-display` aliases to `font-sans` today; sweeping its ~16 callsites lets us drop the alias and use `font-sans font-bold tracking-tight` directly |
| `globals.css` legacy-block removal | `src/app/globals.css:30–46` (the brand named-token block) | The block to delete once nothing references `--color-navy*`, `--color-cream`, `--color-stone-*`, `--color-accent*`. Keep `--color-status-*` (still used by destructive/state surfaces) and `--color-brand-blue` (the value `--primary` resolves to) |

**Conventions referenced:**
- `docs/wiki/layout.md` — post-0043 surface vocabulary (`PageHeader`, `KeyValueStrip`, `Section`, `RowActions`, `Badge`). Migrating to semantic tokens is the chroma layer below that vocabulary.
- The "strategy A" doctrine in `src/app/globals.css:6–27` — once the sweep is done, the two-layer aliasing collapses to one layer (semantic tokens only).

**Overall Progress:** 80% (4/5 phases complete)

**Note:**
- Phase 1 produces the classification artifact the rest of the chunk consumes.
- Phases 2 and 3 split mechanical class swaps from real component swaps so a Codex pass on Phase 2 stays terse.
- Integration tests (`pnpm test`) and lint must stay green through every phase — there are no schema or behavior changes, only class strings and component imports.

### Phase Checklist

#### Phase 1: Audit + classification table
- [x] Run `rg -l -g '*.tsx' -g '*.ts' "(color-navy|color-cream|color-accent|color-stone-|font-display|navy-pale|brand-blue|text-navy|bg-navy|bg-cream)" src/` and capture the full file list (~29 files as of scaffold) — 31 real legacy files captured in [`audit.md`](audit.md) (the original ripgrep missed `text-stone-*`/`bg-stone-*`/`border-stone-*` literals by anchoring on `color-stone-`; a widened scan in the audit catches them)
- [x] For each file, classify each legacy hit into one of: **class-swap** (mechanical token replacement), **component-swap** (hand-rolled button/badge/input cluster that should become a shadcn primitive), **font-display** (typographic alias) — see audit.md "File classification"
- [x] Produce the token-mapping table as a Phase-1 commit — see audit.md "Token mapping" (extended with `text-stone-400` → `text-muted-foreground/70`, `bg-stone-400` → `bg-muted-foreground`, `bg-navy-pale` → `bg-primary/10`, etc. — denser than the seeds in the plan body)
- [x] Flag any callsite that doesn't map cleanly — coach-shared public surfaces (`login`, `share/coach/[id]`) decision: **migrate** (logo blue is already `--primary`; `bg-cream` is legacy off-white the modern aesthetic doesn't lean on). Decision captured in audit.md "Coach-shared public surfaces" section.

#### Phase 2: Class-swap codemod sweep
- [x] Sweep `src/app/(app)/*` files (10 files: reports, quotes-filters, production-filters, quotes/page, production/page, dealerships/[id], quotes/[id], calendar/booking-form, calendar/calendar-view, calendar/event-detail) — committed at `1166391` alongside `codemod.mjs`
- [x] Sweep `src/features/*` files (14 files across dealers, msa, reports, schedule, services, people, quotes) — committed at `eea89f2`
- [x] Sweep stragglers under `src/components/app/*` + `src/components/ui/*` (5 files: app-header, app-nav, user-menu, data-table, toaster) and coach-shared public surfaces (`login`, `share/coach/[id]`) — committed at `8a22e72`
- [x] After each commit: `tsc --noEmit` clean; `pnpm test` shows 2 pre-existing pool-exhaustion flakes (`tests/integration/rls.test.ts` × 2) confirmed neutral to codemod via stash + individual-file passes; lint deferred to chunk-end `/eval`
- [x] Verify no new uses of legacy tokens crept in — final ripgrep shows zero legacy class-swap tokens outside `globals.css`; only `font-display` callsites (8) remain for Phase 3

#### Phase 3: Component-swap sweep + font-display retirement
- [x] Replace hand-rolled button clusters with `<Button>` — quote-composer.tsx: 3 buttons (Close/Preview/Save) at the composer-actions block (Send retains custom `bg-status-green`); people-admin.tsx: 5 sites (headerAddClass → outline+accent, rowEditClass → outline×2 incl. DialogClose via `buttonVariants()`, rowDeleteClass → destructive, submitClass → default). 4 class consts deleted.
- [x] ~~Replace hand-rolled badge/pill spans with `<Badge>` variants~~ — pillClass in people-admin powers interactive role-filter chips (not status badges); Badge variants don't carry filter-chip semantics. Pill chrome is 100% semantic tokens post-Phase 2; leaving as-is. The badge-related work in 0043 follow-up (c) (CampaignStatusBadge/PersonLifecycleBadge) is a separate scope.
- [x] Sweep all `font-display` callsites — 8 sites (quote-composer ×3, calendar-view ×2, orphan-auth-users ×1, services-admin ×1, lookup-admin ×1) → `font-sans font-bold tracking-tight`. `--font-display` alias drop happens in Phase 4 alongside the legacy `@theme inline` block.
- [x] Also caught: `accent-navy` (production-filters), `focus-visible:ring-navy/30` (people-admin) — codemod extended to handle ring-/accent- forms.
- [x] Static gate green: `tsc --noEmit` clean, vitest 790/790 PASS (RLS + MSA pool-flakes excluded per Phase 2 caveat)

#### Phase 4: Delete legacy block from `globals.css`
- [x] Re-run the ripgrep — confirmed zero matches outside `globals.css` (all surviving hits are doc-comments inside the file itself, see Phase 1 anchor)
- [x] Deleted `--color-navy`, `--color-navy-light`, `--color-navy-pale`, `--color-accent`, `--color-accent-light`, `--color-cream`, `--color-stone-{100,200,400,600,800}`, `--font-display` from `@theme inline`. Kept `--color-brand-blue`, `--color-brand-blue-fg`, `--color-status-{red,green,blue}` (load-bearing).
- [x] Inlined the previously-aliased values into `:root` directly: `--foreground: #2c2a26`, `--secondary: #f4f2ee`, `--muted: #f4f2ee`, `--muted-foreground: #6b6760`, `--accent: #b88a3a`, `--border: #e8e4dd`, `--input: #e8e4dd`. `--primary` / `--ring` still resolve via `var(--color-brand-blue)`; `--destructive` resolves via `var(--color-status-red)`.
- [x] Rewrote the top comment block to reflect single-layer reality + dropped the `font-display` "later cleanup" preamble (cleanup is now done).
- [x] `pnpm build` clean (3.3s compile, 19/19 routes, zero warnings); `tsc --noEmit` clean; vitest 790/790 PASS; `pnpm lint` 0 errors / 10 pre-existing warnings.

#### Phase 5: Smoke + Codex eval
- [ ] `web-test` smoke against the high-touch routes: `goto /quotes` (expect "Quotes" heading + filter pills + table); `goto /quotes/new` (composer renders, action toolbar at `top-16`); `goto /quotes/<id>` for any seeded quote (KeyValueStrip + Sections render with semantic-token chrome); `goto /dealerships` (list); `goto /dealerships/<id>` (detail); `goto /calendar` (booking + event detail surfaces); `goto /admin/people` (table + lifecycle badges); `goto /login` (kept-brand surface if any decision was made in Phase 1)
- [ ] Screenshot a before/after of `/quotes/new` composer and the `/admin/people` row (the two surfaces where hand-rolled clusters were swapped) — visual confirmation that the chrome didn't drift, just the source-of-truth
- [ ] Run `/eval` for the chunk — expect static green and a clean Codex pass; doc-only or sweep-style chunks tend to surface only "out-of-scope" Codex Mediums, so park appropriately ([[feedback_docs_eval_single_pass]] applies to the doc-comment edits in `globals.css` but not to the component sweeps — full eval here)
- [ ] If `/eval` PASS-with-warnings or better → auto-close via `/build`'s chunk-end ritual (move folder to `closed/`, sweep cross-refs, update `CURRENT.md`)
