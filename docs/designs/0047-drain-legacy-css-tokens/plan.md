# Drain the legacy CSS token layer

**Started:** 2026-05-13

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Audit + classification table | Done | - |
| 2: Class-swap codemod sweep (`stone-*`, `navy`, `cream`, `accent-*`) | Pending | - |
| 3: Component-swap sweep (hand-rolled buttons/badges → shadcn primitives) + `font-display` retirement | Pending | - |
| 4: Delete legacy block from `globals.css` + assert no orphaned refs | Pending | - |
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

**Overall Progress:** 20% (1/5 phases complete)

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
- [ ] Sweep `src/app/(app)/*` files in alphabetical order (smallest blast radius first: filters, then list pages, then detail pages, then composer). Commit per logical area (e.g. `feat(ui): semantic tokens in /quotes`, `feat(ui): semantic tokens in /dealerships`)
- [ ] Sweep `src/features/*` files in the same way, grouped by feature module (`features/dealers/*`, `features/people/*`, `features/quotes/*`, `features/schedule/*`, `features/reports/*`, `features/msa/*`, `features/services/*`)
- [ ] Sweep stragglers under `src/components/app/*` and `src/components/ui/*` (e.g. `app-header.tsx`, `app-nav.tsx`, `user-menu.tsx`, `toaster.tsx`, `data-table.tsx` — five files that still ship legacy classes despite living in the "modernized" tree)
- [ ] After each commit: `pnpm tsc --noEmit && pnpm test && pnpm lint` — green required before the next file
- [ ] Verify no new uses of legacy tokens crept in: rerun the Phase-1 ripgrep and confirm the result set shrinks monotonically

#### Phase 3: Component-swap sweep + font-display retirement
- [ ] Replace hand-rolled button clusters with `<Button>` from `src/components/ui/button.tsx` — known callsites: `quote-composer.tsx:379–399` (3 buttons), `people-admin.tsx:119–134` (3 buttons + 1 checkbox-styled span), and any others Phase 1 flagged
- [ ] Replace hand-rolled badge/pill spans with `<Badge>` variants from `src/components/ui/badge.tsx` — known callsites: `people-admin.tsx:157`, plus any caught by 0043 follow-up (c) parking notes if not already addressed
- [ ] Sweep all `font-display` callsites (~16) → `font-sans font-bold tracking-tight`; drop the `--font-display` alias from `globals.css:71` once no callsites remain
- [ ] Drop the `font-display` comment block in `globals.css:22–26` (the "later cleanup" the file documents)
- [ ] Static gate green after each logical commit

#### Phase 4: Delete legacy block from `globals.css`
- [ ] Re-run the ripgrep — confirm zero matches for `color-navy|color-cream|color-stone-|font-display|navy-pale|bg-cream|text-navy|bg-navy|accent-light` across the entire `src/` tree (`globals.css` aside)
- [ ] Delete the brand named-tokens block at `src/app/globals.css:30–46` — keep `--color-status-*` (still wired to `--destructive` / state surfaces) and the `--color-brand-blue` definition (load-bearing — `--primary` resolves to it)
- [ ] Simplify the file's top comment block — "strategy A" two-layer aliasing collapses to one layer; update the explanation to reflect the new single-layer reality
- [ ] `pnpm build` to confirm Tailwind doesn't emit unresolvable-token warnings; `pnpm tsc --noEmit && pnpm test && pnpm lint` green

#### Phase 5: Smoke + Codex eval
- [ ] `web-test` smoke against the high-touch routes: `goto /quotes` (expect "Quotes" heading + filter pills + table); `goto /quotes/new` (composer renders, action toolbar at `top-16`); `goto /quotes/<id>` for any seeded quote (KeyValueStrip + Sections render with semantic-token chrome); `goto /dealerships` (list); `goto /dealerships/<id>` (detail); `goto /calendar` (booking + event detail surfaces); `goto /admin/people` (table + lifecycle badges); `goto /login` (kept-brand surface if any decision was made in Phase 1)
- [ ] Screenshot a before/after of `/quotes/new` composer and the `/admin/people` row (the two surfaces where hand-rolled clusters were swapped) — visual confirmation that the chrome didn't drift, just the source-of-truth
- [ ] Run `/eval` for the chunk — expect static green and a clean Codex pass; doc-only or sweep-style chunks tend to surface only "out-of-scope" Codex Mediums, so park appropriately ([[feedback_docs_eval_single_pass]] applies to the doc-comment edits in `globals.css` but not to the component sweeps — full eval here)
- [ ] If `/eval` PASS-with-warnings or better → auto-close via `/build`'s chunk-end ritual (move folder to `closed/`, sweep cross-refs, update `CURRENT.md`)
