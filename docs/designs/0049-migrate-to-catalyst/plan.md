# Migrate to Catalyst + drain ALL legacy CSS

**Started:** 2026-05-13

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Catalyst install + dep mapping + gap decisions | Pending | - |
| 2: Logo-derived `brand` palette + zinc neutrals + `globals.css` reshape (no semantic-token layer) | Pending | - |
| 3: Primitive swap — Button, Badge, Field/FieldGroup/Label, Input, Textarea | Pending | - |
| 4: Primitive swap — Dialog, Combobox, Select/Listbox, Checkbox, Dropdown | Pending | - |
| 5: DataTable restyle + rewire 0043 conventions (PageHeader, RowActions, KeyValueStrip, Section) | Pending | - |
| 6: Drain ALL legacy CSS from `globals.css` (delete `--color-*`, `--shadow-*`, `--radius-*`) | Pending | - |
| 7: Remove orphaned UI deps (`@base-ui/react`, `shadcn`, three Radix primitives, `cva`, `tailwind-merge` if unused) | Pending | - |
| 8: Smoke + Codex eval | Pending | - |

This chunk replaces the shadcn + Base UI + standalone Radix primitive stack with Catalyst (Tailwind UI Kit at `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/`), and drains every project-specific CSS custom property from `src/app/globals.css` so the file is reduced to Tailwind base + the load-bearing print stylesheet + whatever Catalyst's component-CSS expects (per-component `--btn-bg`/`--btn-border`/etc. tokens are component-scoped, not global). Catalyst's design philosophy is "Tailwind's default palettes plus per-component CSS custom props" — incompatible with shadcn's `--primary`/`--accent`/`--muted` semantic-token layer, so the 0047 single-layer collapse gets replaced wholesale rather than extended. "Done" is: every shadcn primitive in `src/components/ui/*` deleted; every callsite uses Catalyst; `globals.css` contains only `@import "tailwindcss"`, the print stylesheet, the `body`/`@layer base` rules, and a Tailwind `@theme` block that defines a logo-derived `brand` color ramp + zinc neutrals; the unused UI deps are removed from `package.json`; static + browser + Codex eval clean. Chroma-from-logo is **folded into Phase 2** (user decision 2026-05-13) — the starter palette is logo-derived from the start, not a Tailwind-default placeholder, so no follow-up chunk needed for chroma.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape. This chunk is a primitive-swap sweep — the anchors are pairs of "the file we're moving away from" and "the Catalyst source it's moving to."

| Work | Anchor (`path:line`) | Why this anchor |
|------|---------------------|-----------------|
| Catalyst component sources (new `src/components/catalyst/*`) | `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/button.tsx` (and siblings) | Direct source — copy verbatim; do not re-style at copy time. Catalyst components are "you own the code" like shadcn |
| Tailwind palette config in `globals.css` | `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/button.tsx:1-50` (Catalyst's `var(--color-zinc-500)` / `var(--color-blue-500)` usage) | Catalyst reads Tailwind v4's named-palette tokens directly via `var(...)` — extend Tailwind's theme to register a `brand` color whose 50–950 ramp is logo-derived, plus keep Tailwind's default `zinc` for neutrals |
| Button callsites | `src/components/ui/button.tsx:8-35` (current cva map) → `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/button.tsx` | Catalyst Button takes `color="..."` + `outline` + `plain` props instead of `variant="..."` — every callsite needs the prop translated |
| Badge callsites | `src/components/ui/badge.tsx:6-29` (cva map with `success`/`warning`/`info`) → `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/badge.tsx` | Catalyst Badge has per-color `color="..."` (zinc/blue/amber/etc.) — the 0043 status-affordance triple (`success`/`warning`/`info`) maps to (`green`/`amber`/`blue`) |
| Field/FieldGroup/Label callsites | `src/components/ui/field.tsx` → `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/fieldset.tsx` | Catalyst `fieldset.tsx` exports `<Fieldset>` / `<Legend>` / `<FieldGroup>` / `<Field>` / `<Label>` / `<Description>` / `<ErrorMessage>` — close to shadcn's shape but the imports change |
| Dialog callsites | `src/components/ui/dialog.tsx:22-23` (DialogClose forwards to Base UI) → `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/dialog.tsx` | Catalyst Dialog is Headless UI under the hood — different mount semantics from Base UI (no Portal export); compose-time check needed |
| Combobox callsites | `src/components/ui/combobox.tsx` (Base UI) → `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/combobox.tsx` (Headless UI) | Both are headless-style; data shape stays the same. Combobox is used in `dealer-form.tsx`, `quote-composer.tsx`, `people-admin.tsx` (3 callsites) |
| DataTable restyle | `src/components/ui/data-table.tsx` (TanStack wrapper) → `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/table.tsx` | Catalyst `<Table>` / `<TableHead>` / `<TableBody>` / `<TableRow>` / `<TableCell>` are bare primitives; keep TanStack's `useReactTable` row model, restyle the chrome |
| 0043 conventions rewire (PageHeader, RowActions, KeyValueStrip, Section) | `src/components/app/page-header.tsx:27` (canonical surface chrome) | These are *compositions* over primitives — they stay as files; only their internal Button/Badge/etc. imports swap to Catalyst |
| `globals.css` drain | `src/app/globals.css:1-90` (post-0047 single-layer) | The target shape: drop the `--color-*`/`--shadow-*`/`--radius-*` blocks entirely; keep `@import "tailwindcss"`, the new logo-derived `@theme` brand ramp (added in Phase 2), the `body` rule, `@media print`, and `@layer base`. `tw-animate-css` import dropped in Phase 2 |
| Orphan-dep removal | `package.json:1-100` (current deps) | After all callsites swap, grep-verify zero remaining imports of `@base-ui/react`, `@radix-ui/react-{checkbox,dropdown-menu,select,slot}`, `class-variance-authority`, `tailwind-merge`; then `pnpm remove` each |

**Conventions referenced:**
- `docs/wiki/layout.md` — post-0043 page conventions (PageHeader, RowActions, KeyValueStrip, Section, Badge) survive this migration; only their internals get rewired
- `CLAUDE.md` → "Git Workflow" — `feat(ui)`/`feat(deps)`/`fix(ui)`/`docs(plan)` scope tags; subject-line-only commits
- Catalyst docs at https://catalyst.tailwindui.com/docs — Tailwind UI subscription required (the user has it)

**Conventions retired:**
- `src/components/ui/*` — the entire shadcn primitive layer (~16 files) gets deleted at the end of Phase 7
- shadcn's `--primary`/`--accent`/`--secondary`/`--muted`/`--card`/`--popover` semantic-token layer (the post-0047 collapse) gets replaced by Catalyst's per-component CSS custom-prop approach
- `cn()` from `src/lib/utils.ts` — Catalyst uses `clsx` directly; the `tw-merge` wrapper becomes orphan unless other callers exist (check during Phase 7)

**Overall Progress:** 0% (0/8 phases complete)

**Note:**
- This is a foundation swap; behavior should be visually equivalent or better per-component, never worse
- Test the gated surface continuously — every primitive swap risks `/quotes`, `/dealerships`, `/admin/people` regressions
- Chunk is large enough that it may become an umbrella tracker if Phase 3 or 4 reveals a natural sub-plan seam (e.g. "form primitives" as one sub-plan, "overlay primitives" as another). If so, retire this plan to the parent and scaffold sub-plans under it
- Smoke at the end of each phase via `pnpm tsc --noEmit && pnpm test` (the fast gate); full `/eval` only at chunk-end
- `tw-animate-css` import: dropped in Phase 2 (user decision — Catalyst uses Headless UI `<Transition>`)
- Print stylesheet (`globals.css:101-125` post-0047) is load-bearing for `/quotes/[id]` PDF render — keep verbatim through every phase

### Phase Checklist

#### Phase 1: Catalyst install + dep mapping + gap decisions

- [ ] Copy `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/*.tsx` (27 files) into `src/components/catalyst/`. Do not modify at copy time — verbatim.
- [ ] `pnpm add @headlessui/react motion clsx` (Catalyst's hard deps per its README).
- [ ] Confirm Tailwind is on v4.0+ (`pnpm list tailwindcss`). The repo currently runs Tailwind v4 (per `globals.css:1` `@import "tailwindcss"`); no upgrade should be needed.
- [ ] Build a `src/components/catalyst/INDEX.md` (or similar working note in this plan folder) mapping every current shadcn callsite to its Catalyst counterpart. Capture:
  - Button (2 callsite files, dozens of sites within) — Catalyst `<Button color="zinc">` / `outline` / `plain` props
  - Badge (used app-wide via the 0043 wrappers `QuoteStatusBadge`/`PersonLifecycleBadge`/etc.) — Catalyst `<Badge color="zinc">` per status
  - Dialog (9 callsite files) — Catalyst `<Dialog>` / `<DialogTitle>` / `<DialogDescription>` / `<DialogBody>` / `<DialogActions>` shape
  - Combobox (3 callsite files: `dealer-form.tsx`, `quote-composer.tsx`, `people-admin.tsx`)
  - Input/Textarea/Field/FieldGroup/FieldLabel (~6 callsite files each)
  - Radix Checkbox (1 callsite: `people-admin.tsx`) — Catalyst `<Checkbox>`
  - Radix Dropdown (2 callsite files) — Catalyst `<Dropdown>` / `<DropdownButton>` / `<DropdownMenu>`
  - Radix Select (1 callsite) — Catalyst `<Listbox>` (Catalyst's select equivalent)
- [ ] Decide the three known gaps and document the call in the mapping doc:
  - **DataTable** — recommendation: keep TanStack `useReactTable` row model, restyle by composing Catalyst `<Table>`/`<TableRow>`/`<TableCell>` primitives. The 0043 `<RowActions>` survives as the row-action callsite.
  - **ToggleGroup** (1 callsite: `quote-composer.tsx`) — **decided: build custom on Headless UI `<RadioGroup>`** (user decision 2026-05-13). Lives at `src/components/catalyst/toggle-group.tsx` so the primitive layer is pure Catalyst + Headless UI; no retained shadcn primitive.
  - **Toaster** — recommendation: keep current `src/components/ui/toaster.tsx` (sonner-based). Catalyst doesn't ship a toaster. Mark it explicitly as a kept-shadcn file; do not delete in Phase 7.
- [ ] Confirm Catalyst's expected CSS shape by reading at least 3 Catalyst components (`button.tsx`, `dialog.tsx`, `input.tsx`) and noting which CSS custom props they expect (`--btn-bg`, `--btn-border`, etc.). These get defined per-component, not globally; document the implication for Phase 6's CSS drain.

#### Phase 2: Logo-derived `brand` palette + zinc neutrals + `globals.css` reshape

- [ ] **Eyedropper the logo** at `public/saledayevents-logo.jpg` for the brand seed. Known anchor from prior chunks: `#1a5fa8` (logo blue, eyedropper range `#1a5fa8–#1f6bc2`). Confirm with a fresh pixel sample — pick the visually-dominant value as the `brand-500` mid-tone.
- [ ] **Generate a logo-anchored ramp** for `brand-50/100/200/300/400/500/600/700/800/900/950` using OKLCH-spaced lightness steps around the seed. Tools that produce one obvious answer: uicolors.app, palette.style, or a small ad-hoc OKLCH script (preferred — checked-in and re-runnable). The seed's OKLCH chroma + hue stay constant across the ramp; only lightness varies. Document the generator approach in a `docs/designs/0049-migrate-to-catalyst/palette.md` artifact (script or table) so the choice is reversible.
- [ ] **Register the ramp** in Tailwind v4's `@theme` block inside `src/app/globals.css` as `--color-brand-50` through `--color-brand-950`. Catalyst components use `<Button color="brand">` / `<Badge color="brand">` etc. — naming the family `brand` lets every callsite use a stable name regardless of the underlying hex values (chroma can re-tune later via a 1-file edit, no callsite churn).
- [ ] **Neutrals: keep Tailwind's default `zinc`** (user decision 2026-05-13, soft commit — flippable to `slate`/`stone`/`neutral` family if the live UI feels too cool against the brand blue). Catalyst's whole component library is tuned for zinc-on-white; using anything else would require restyling Catalyst components in Phase 3+.
- [ ] **Drop `@import "tw-animate-css"`** (user decision 2026-05-13). Catalyst's animations come from Headless UI's `<Transition>`; the `tw-animate-css` shim is no longer load-bearing.
- [ ] Rewrite `src/app/globals.css` to: keep `@import "tailwindcss"`, the new `@theme` block with the `brand-*` ramp, the `body` rule, `@media print`, and `@layer base`. **Drop** the entire shadcn `--primary`/`--accent`/`--muted`/`--card`/`--popover`/`--secondary`/`--border`/`--input`/`--ring`/`--foreground`/`--background`/`--destructive`/`--radius` semantic-token block, the `:root` source-of-truth block, the `--shadow-*` definitions, the `--radius-sm` through `--radius-4xl` shadcn scale, and the `--font-display`/`--font-heading` aliases (keep `--font-sans: var(--font-inter)`).
- [ ] `pnpm tsc --noEmit && pnpm test` — both green. **Note: the app will look broken at this point** (every shadcn primitive still uses `--primary`/`--muted`/etc. tokens which no longer resolve). This is expected; Phase 3 fixes it by deleting the shadcn primitives entirely. The fast gate is type/test correctness, not visual correctness, at this phase.
- [ ] Commit as `feat(css): logo-derived brand ramp + zinc neutrals; drop shadcn semantic-token layer + tw-animate-css (0049 Phase 2)` — visual brokenness is the explicit trade-off, called out in the message.

#### Phase 3: Primitive swap — Button, Badge, Field/FieldGroup/Label, Input, Textarea

- [ ] **Button:** swap `import { Button } from '@/components/ui/button'` → `import { Button } from '@/components/catalyst/button'` across the 2 known callsite files (`quote-composer.tsx`, `people-admin.tsx`) plus any other `<Button>` callsites surfaced by an updated grep. Translate `variant="default" | "outline" | "destructive"` to Catalyst's `color="..." | outline | plain` prop. Replace `size="xs" | "sm" | "lg"` — Catalyst Button has no size prop (it uses Tailwind's default `text-base/6` + responsive overrides); document where to add custom sizing.
- [ ] **Badge:** swap the 0043 wrapper internals (`src/features/quotes/quote-status-badge.tsx`, `src/features/dealers/dealer-status-badge.tsx`, `src/features/msa/msa-status-badge.tsx`, `src/features/people/person-lifecycle-badge.tsx`, `src/features/campaigns/campaign-status-badge.tsx`) to use Catalyst's `<Badge color="...">`. The `success`/`warning`/`info` mapping becomes `green`/`amber`/`blue`.
- [ ] **Field/FieldGroup/Label:** swap `import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'` → Catalyst's `import { Field, FieldGroup, Label, ErrorMessage } from '@/components/catalyst/fieldset'` across the 6 callsite files. Some prop names differ (`FieldLabel` → `Label`, `FieldError` → `ErrorMessage`).
- [ ] **Input/Textarea:** swap `import { Input } from '@/components/ui/input'` and `import { Textarea } from '@/components/ui/textarea'` → Catalyst's equivalents.
- [ ] After each primitive's sweep: `pnpm tsc --noEmit && pnpm test`. Commit per primitive (`feat(ui): swap Button to Catalyst`, `feat(ui): swap Badge to Catalyst`, etc.). Browser smoke once at the end of the phase, not per primitive.

#### Phase 4: Primitive swap — Dialog, Combobox, Select/Listbox, Checkbox, Dropdown

- [ ] **Dialog:** swap `import { Dialog, DialogContent, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog'` → Catalyst's `<Dialog>` / `<DialogTitle>` / `<DialogDescription>` / `<DialogBody>` / `<DialogActions>` across the 9 callsite files. Note: Catalyst Dialog mounts via Headless UI's `<Transition>` — different SSR semantics from Base UI; check that any `open={false}` dialogs (e.g. `ConfirmSendDialog` in `quote-composer.tsx`) don't trigger hydration drift.
- [ ] **Combobox:** swap `import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, ComboboxEmpty } from '@/components/ui/combobox'` → Catalyst's `import { Combobox, ComboboxLabel, ComboboxOption } from '@/components/catalyst/combobox'` across 3 callsite files. API shapes differ — Catalyst Combobox is Headless UI's `<Combobox>` directly.
- [ ] **Select/Listbox:** find the 1 file using `@radix-ui/react-select` (`people-admin.tsx`'s dealer-link role select) → swap to Catalyst `<Listbox>` (which Catalyst uses as its select equivalent).
- [ ] **Checkbox:** swap `import * as Checkbox from '@radix-ui/react-checkbox'` in `people-admin.tsx` → Catalyst's `<Checkbox>`. The custom `roleCheckboxClass` styling can be replaced by Catalyst's color prop.
- [ ] **Dropdown:** swap `@radix-ui/react-dropdown-menu` callsites (2 files) → Catalyst `<Dropdown>` / `<DropdownButton>` / `<DropdownMenu>` / `<DropdownItem>`.
- [ ] Commit per primitive; fast gate after each.

#### Phase 5: DataTable restyle + rewire 0043 conventions

- [ ] Restyle `src/components/ui/data-table.tsx` — keep TanStack `useReactTable`, replace the inline `<table>` / `<thead>` / `<tr>` / `<th>` / `<td>` JSX with Catalyst's `<Table>` / `<TableHead>` / `<TableRow>` / `<TableHeader>` / `<TableBody>` / `<TableCell>` primitives. Should be a same-file refactor; no callsite changes.
- [ ] Rewire the 0043 app conventions to use Catalyst primitives internally:
  - `src/components/app/page-header.tsx` — internal use of shadcn Button → Catalyst Button (already done if Phase 3 ran).
  - `src/components/app/row-actions.tsx` — internal use of shadcn Button + the icons map → Catalyst Button (same icons).
  - `src/components/app/key-value-strip.tsx` — internal styling; no primitives, but classes may need adjustment for the new zinc palette.
  - `src/components/app/section.tsx` — same.
- [ ] Delete every file in `src/components/ui/*` that has zero remaining importers AND is not the kept Toaster. Specifically:
  - `button.tsx`, `badge.tsx`, `dialog.tsx`, `combobox.tsx`, `select.tsx`, `checkbox.tsx`, `input.tsx`, `textarea.tsx`, `field.tsx`, `dropdown.tsx` (if it exists), and any other shadcn primitives.
  - **Keep:** `toaster.tsx` (no Catalyst equivalent), `data-table.tsx` (restyled, not replaced), `toggle-group.tsx` (if the Phase 1 decision was to keep it).
- [ ] Smoke (web-test): full Phase 2 gated table run.

#### Phase 6: Drain ALL legacy CSS from `globals.css`

- [ ] Re-grep for any remaining usage of project custom properties: `rg "var\(--(?:color|shadow|radius)-" src/`. Expected: zero matches in `src/` outside `globals.css` itself (Catalyst uses Tailwind's `var(--color-zinc-500)` form, which is Tailwind v4's `@theme` output, not a project custom prop).
- [ ] Delete every `--color-*` / `--shadow-*` / `--radius-*` block from `globals.css`. Keep:
  - `@import "tailwindcss"` (Tailwind base — load-bearing).
  - (Drop `@import "tw-animate-css"` if not already done in Phase 2.)
  - The `body { background; color; font-family }` rule.
  - The `@media print` block (load-bearing for `/quotes/[id]` PDF render).
  - The `@layer base` block (`* { border-border outline-ring/50 }` → may need rewriting if `border-border` no longer resolves; same for `bg-background text-foreground`).
- [ ] `pnpm build` — confirm Tailwind compiles clean with the slimmed `globals.css`. Any unresolvable token warnings → fix at the callsite (don't add the token back).
- [ ] Static gate green.

#### Phase 7: Remove orphaned UI deps

- [ ] Confirm zero remaining imports from `@base-ui/react` across `src/`: `rg "from '@base-ui/react" src/` → empty. If empty: `pnpm remove @base-ui/react`.
- [ ] Confirm zero remaining imports from each Radix primitive: `@radix-ui/react-checkbox`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-select`, `@radix-ui/react-slot`. Remove each as it goes empty.
- [ ] Confirm zero remaining imports of `cva` from `class-variance-authority`. If empty: `pnpm remove class-variance-authority`.
- [ ] Confirm zero remaining imports of `cn()` from `@/lib/utils` that depend on `tailwind-merge` — Catalyst uses `clsx` directly. If `cn()` is orphan, delete the helper and `pnpm remove tailwind-merge`. Otherwise leave both.
- [ ] Remove the `shadcn` package and its config: `pnpm remove shadcn`; delete `components.json`. Catalyst doesn't use a CLI registry, so the shadcn CLI is fully retired.
- [ ] `pnpm install` to refresh the lockfile; `pnpm build` clean.
- [ ] Static + lint gate green.

#### Phase 8: Smoke + Codex eval

- [ ] `web-test` smoke against the high-touch routes:
  - `goto /login` (public surface, Catalyst Button + Input render)
  - `goto /share/coach/1` (public Catalyst chrome)
  - `goto /calendar` (Master Schedule + Block Date dialog + + Book Event dialog — Catalyst Dialog + Combobox)
  - `goto /quotes` (filter pills via Catalyst Badge + table via restyled DataTable)
  - `goto /quotes/new` (composer — Catalyst Button + Combobox + Field/Input/Textarea)
  - `goto /quotes/4` (composer edit-mode — all 4 action Buttons via Catalyst)
  - `goto /admin/people` (Coach/Admin/Customer-side filter pills + Add Person dialog + Catalyst Checkbox triple)
  - `goto /dealerships` (filter pills via Catalyst Badge + + Add Dealer button)
  - `goto /production` (filter combobox via Catalyst Listbox + Show cancelled Checkbox)
- [ ] Screenshot before/after of `/quotes/new` and `/admin/people` Add Person dialog — the two surfaces most affected by the primitive sweep
- [ ] Run `/eval` for the chunk — expect static green, browser smoke 9/9 PASS, Codex review covering: (a) primitive swap correctness, (b) prop-translation fidelity (variant→color, etc.), (c) any orphan import / unused export / dead `_` var, (d) Catalyst component API misuse (wrong prop names, missing `onClose` on Dialog, etc.), (e) `globals.css` drain completeness, (f) dep-removal safety
- [ ] If `/eval` PASS or PASS-with-warnings → auto-close via `/build`'s chunk-end ritual (move folder to `closed/`, sweep cross-refs, update `CURRENT.md`)
- [ ] If umbrella-tracker promotion makes sense post-eval (e.g. Phase 3 + 4 became sub-chunks mid-build): retire this plan as the parent, scaffold the actually-shipped slices as `closed/` siblings

## Decisions locked (2026-05-13)

All 5 scaffold-stage open questions answered by the user before Phase 1 starts:

1. **Tailwind UI license — confirmed.** Catalyst sources at `/Users/davidwhogan/Downloads/catalyst-ui-kit/typescript/` will be copied into `src/components/catalyst/` under the Tailwind Plus license.
2. **Starter palette — logo-derived (not a Tailwind default).** Eyedropper `public/saledayevents-logo.jpg` for the brand seed (anchor: `#1a5fa8`); generate an OKLCH-spaced `brand-50…950` ramp; register in Tailwind v4 `@theme`. Chroma-from-logo work is folded into Phase 2 — there is no follow-up chunk for chroma. See Phase 2 checklist for the generator-script convention.
3. **Neutrals — `zinc`** (soft commit — flippable to `slate`/`stone`/`neutral` post-Phase 3 if the live UI feels too cool against the brand blue).
4. **ToggleGroup — build custom on Headless UI `<RadioGroup>`.** Lives at `src/components/catalyst/toggle-group.tsx` so the primitive layer is pure Catalyst + Headless UI; no retained shadcn primitive. One callsite to swap (`quote-composer.tsx`).
5. **`tw-animate-css` — drop.** Removed in Phase 2 alongside the semantic-token block. Catalyst uses Headless UI `<Transition>` for animations.

## Out-of-scope / future-chunk material

- **Dark mode.** Catalyst ships dark-mode classes on every component. Currently the app is light-only (per `globals.css:18-20` post-0047). Promoting dark mode is a separate decision.
- **Toaster swap.** If Catalyst ever ships a toaster, revisit. Until then, the current sonner-based toaster stays.
- **Marketing-site palette alignment.** salesability.ca and SaleDay app theming convergence is a separate strategy concern — see `docs/strategy/vision.md`. The logo-derived `brand` ramp from Phase 2 is the natural anchor for that future convergence work.
