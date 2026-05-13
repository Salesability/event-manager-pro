# shadcn/ui sweep — primitives + form stack adoption

**Started:** 2026-05-12
**Status:** Scaffolded — Parked (un-park trigger: 0041 ships AND the uncommitted 0035 quote-composer RHF work is committed; otherwise this sweep collides with the in-flight Send-receipt + composer work).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: shadcn init + theme reconciliation | Done | `fd2ad89` |
| 2: Form stack (`<Form>` + helpers) | Done | `09ad506` |
| 3: Port `quote-composer.tsx` | Done | `2462b0c` |
| 4: Port `dealer-form.tsx` + `booking-form.tsx` | Done | `29fd30d` |
| 5: Primitive sweep (dialog / combobox / tabs) | Done | `b4df471` |
| 6: Docs (wiki) + Radix Form removal | Pending | - |
| 7: Tests + smoke verification | Pending | - |

Adopt shadcn/ui as the project baseline for forms and common UI primitives so every form looks and behaves the same, while preserving the existing palette (navy/accent/stone/status-red), the Server-Action-only mutation rule (CLAUDE.md), and the in-house `toaster` + `data-table` which carry project-specific behaviour. Done = (a) shadcn initialized with explicit choices captured in this plan, (b) the four current form files (`quote-composer.tsx`, `dealer-form.tsx`, `booking-form.tsx`, plus whichever others surface) all use the same `<Form>`/`<FormField>` stack on top of react-hook-form + zod, (c) Server Actions still own submission via `form.handleSubmit(async values => action(...))` with `setError` mapping field errors back, (d) Radix Form removed from `package.json` once the last consumer is ported, (e) a `docs/wiki/forms.md` page captures the convention.

**Overall Progress:** 71% (5/7 phases complete)

## Decisions locked (2026-05-12)

- **Theme:** `modern-minimal` (tweakcn / shadcn theme directory). White/near-white surfaces, neutral grey scale, hairline borders, modest radius, Inter sans. Reason: brand logo (`public/saledayevents-logo.jpg`) is blue + warm-grey; the existing warm-gold accent in `globals.css` is a layer over a logo that doesn't contain gold. `modern-minimal` lets the logo be the chromatic anchor and matches the wordmark's geometric-sans character.
- **Primary override:** logo blue (eyedropper the actual file at Phase 1 — approx `#1a5fa8` to `#1f6bc2`, oklch ~`(0.5 0.13 250)`). Do not adopt `modern-minimal`'s default primary.
- **Warm-gold accent dropped from the semantic layer.** Keep `--color-accent` defined only if specific surfaces still consume it during transition; remove by chunk-end if no live consumers.
- **Style axis:** `new-york` (tighter density, matches geometric-sans wordmark + modern-minimal aesthetic).
- **Theme strategy:** A — alias shadcn semantic tokens (`--primary`, `--background`, `--foreground`, `--muted`, `--border`, `--ring`, `--destructive`, etc.) to existing or new named tokens in `@theme inline` so the rest of the codebase keeps reading named tokens directly.
- **Display font:** drop DM Serif Display entirely (user does not like it). Default sans switches to Inter per `modern-minimal`. Page titles and section headers currently using the `font-display` class (~20 sites across `src/app/(app)/**` and `src/features/**` — see grep results captured during planning) move to bold Inter (`font-sans font-bold tracking-tight`, sized via `text-{xl,2xl,3xl}` as today). Remove the `DM_Serif_Display` import from `src/app/layout.tsx` and the `--font-dm-serif` / `--font-display` tokens from `globals.css` in Phase 1.

Token mapping (strategy A):
- `--background` ← white (replace current `--color-cream`)
- `--foreground` ← `--color-stone-800`
- `--primary` ← new `--color-brand-blue` (logo blue)
- `--muted` / `--muted-foreground` ← `--color-stone-100` / `--color-stone-600`
- `--border` / `--input` ← `--color-stone-200`
- `--destructive` ← `--color-status-red`
- `--ring` ← `--color-brand-blue`

## Open Questions

The Phase 1 implementation needs answers to these before files start moving. Plan blocks here, not at Phase 3.

1. ~~**shadcn style choice**~~ — Resolved (Decisions): `new-york`.
2. ~~**Theme reconciliation strategy**~~ — Resolved (Decisions): strategy A. Token mapping recorded above.
3. **`components.json` paths** — match existing convention: `components: "@/components/ui"`, `utils: "@/lib/utils"` (`utils.ts` doesn't exist yet; shadcn generates it on init — fine). CSS path: `src/app/globals.css`. Tailwind config: there is **no `tailwind.config.*`** in this repo (Tailwind v4 + the Next plugin); shadcn init must be pointed at the v4 setup or it will scaffold a stale config.
4. **Server-Action ↔ RHF helper** — one shared helper (`src/lib/actions/form-bind.ts`) that takes a Server Action result `{ ok: true } | { error, fieldErrors? }` and either resolves cleanly or calls `setError` per field, OR inline the same five lines at each call site. Recommendation: one shared helper once two forms need it; inline at the first.
5. **Radix Form removal** — once Phase 4 lands, are there any other Radix Form consumers? `grep -rl '@radix-ui/react-form' src/` says only `dealer-form.tsx` today, but verify mid-Phase 6. Removal goes in Phase 6 commit alongside the wiki page.
6. **Composer port timing** — the in-flight quote-composer changes (uncommitted in working tree, RHF + zod refactor) are *already on the target pattern minus the shadcn primitives*. Phase 3 is a primitive swap, not a re-architecture. Confirm those changes are committed (via 0035/0040 chunk-end) before this phase starts — same-file collisions otherwise.
7. **In-house primitives kept vs swapped** — `combobox.tsx`, `dialog.tsx`, `tabs.tsx` should swap (shadcn equivalents are clean). `data-table.tsx` keeps (carries column-config conventions from 0023). `toaster.tsx` keeps (writes to audit log via toast callbacks per closed/0030). Confirm `toaster` behaviour is non-trivial vs. shadcn's `sonner`-based default before deciding.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `components.json` (root) | n/a — first instance | Generated by `shadcn init`; choices captured in Phase 1 |
| `src/components/ui/form.tsx` (shadcn `<Form>`) | `src/features/quotes/quote-composer.tsx:131` (current RHF use) | Same RHF + zod stack; the wrapper just adds label/error/description plumbing |
| `src/components/ui/input.tsx` / `label.tsx` / `button.tsx` / `select.tsx` | `src/components/ui/dialog.tsx` (existing in-house primitive shape) | Same file location, same export pattern (named function + cn util) |
| `src/lib/utils.ts` (`cn` helper, shadcn-generated) | n/a — first instance | Standard `clsx + tailwind-merge`; init writes it |
| `src/lib/actions/form-bind.ts` (RHF `setError` ← Server Action error helper) | `src/lib/actions/legacy-result.ts:1` (`toLegacyResult` shape) | Same layer — adapter between Server Action result shapes and a client consumer |
| `src/features/quotes/quote-composer.tsx` (primitive swap) | itself (post-RHF refactor, currently uncommitted) | Pattern is already RHF + zod; this phase only swaps raw `<input>` + Radix `Combobox` to shadcn `<FormField>` + shadcn `<Combobox>` |
| `src/features/dealers/dealer-form.tsx` (port) | `src/features/quotes/quote-composer.tsx` (post-Phase 3) | Becomes the second example of the same pattern — RHF + zod + shadcn `<Form>` + Server Action submission |
| `src/app/(app)/calendar/booking-form.tsx` (port) | same as above | Third example; once it matches, the pattern is established for any future form |
| `docs/wiki/forms.md` | `docs/wiki/conventions.md` (existing convention page shape) | Same wiki layer; sibling page |

**Conventions referenced:**
- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers." — Phase 4's port keeps Server Actions as the submission target; `useMutation` is explicitly out of scope.
- `docs/wiki/conventions.md` — extend in Phase 6 with the form convention (or split out `forms.md` if it gets long enough).

**Note:**
- Each phase includes both implementation and tests
- Phase 7 is end-to-end browser smoke + a full vitest run (no DB integration touched — this chunk is UI-only)
- Phases 3 and 4 each ship their form independently — green vitest + tsc gate per phase, full `/eval` only at chunk-end (per the post-0040 `/build` cadence)

### Phase Checklist

#### Phase 1: shadcn init + theme reconciliation
- [x] ~~Answer the open questions above~~ — OQ#1 + #2 resolved in the **Decisions locked** block; OQ#4 carry-forward (inline at first form, share helper at second); OQ#6 cleared (0035 RHF committed at `f540c46`); OQ#7 confirmed in-place (`toaster` already uses sonner with audit callbacks per closed/0030)
- [x] Run `pnpm dlx shadcn@latest init -d`; it scaffolded `components.json` (preset `base-nova` — shadcn 4.x's canonical Base UI–backed style; supersedes the plan-body's "new-york + Radix" framing which was 3.x-era thinking), `src/lib/utils.ts` (cn helper), `src/components/ui/button.tsx`, and installed `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, `@base-ui/react`, `shadcn` as deps. **Note for Phase 5:** existing in-house primitives (`dialog`, `combobox`, `tabs`) wrap Radix; the swap target is the Base UI shadcn equivalents — same `shadcn add <name>` flow as the form primitives.
- [x] Reconcile `globals.css`: rewrote per strategy A — `@theme inline` aliases shadcn semantic tokens (`--primary`, `--background`, `--muted`, `--border`, `--ring`, `--destructive`, …) to a `:root` block that points at our brand named tokens; primary = `--color-brand-blue` (= `#1a5fa8`, the existing `--color-status-blue`); muted = `--color-stone-100`; border/input = `--color-stone-200`; destructive = `--color-status-red`. Dropped the stale `@import "shadcn/tailwind.css"` line (no such file ships with the shadcn package), dropped the entire `.dark` block (app is light-only — re-add as a separate chunk if dark mode becomes a thing). Kept legacy `--color-cream` for the two public `bg-cream` consumers (`src/app/login/page.tsx`, `src/app/share/coach/[id]/page.tsx`).
- [x] Drop DM Serif Display + DM Sans; switch sans to Inter via `next/font/google`. `layout.tsx` rewritten to import `Inter` only (variable `--font-inter`), HTML class simplified. `--font-display` aliased to `--font-sans` in `globals.css` so the ~16 existing `font-display` class sites keep rendering (in Inter) without a same-phase blast-radius sweep; a follow-up sweep can replace `font-display` with `font-sans font-bold tracking-tight` per the plan's locked decisions.
- [x] Verify Tailwind v4 + Next plugin still build — `pnpm dev` already up; `/login` returns 200 + renders the Continue-with-Google + email + magic-link surface unchanged. Full `pnpm build` deferred to Phase 7 chunk-end smoke (heavier than the per-phase gate budget).
- [x] `tsc + test` gate green (tsc clean, 757/759 PASS)

#### Phase 2: Form stack (`<Form>` + helpers)
- [x] `pnpm dlx shadcn@latest add input label button select textarea` — Base UI primitives via the `base-nova` preset (shadcn 4.x canonical). The `form` keyword adds nothing on `base-nova` (Base UI has no Form primitive); the form.tsx wrapper landed by hand below.
- [x] ~~`src/components/ui/form.tsx` written manually — classic shadcn-shape wrapper (`Form` = `FormProvider`; `FormField` = `Controller` + `FormFieldContext`; etc.)~~ — **Deleted mid-phase.** The shadcn skill's authoritative rules surfaced that shadcn 4.x ships `Field`/`FieldGroup` primitives (`@shadcn/field`), NOT the classic `FormField`/`FormItem`/`useFormField` pattern from pre-4.x. Pivot: dropped the hand-written `form.tsx` + the `form-bind.ts` helper; added `@shadcn/field` + `@shadcn/toggle-group` (which transitively brought `toggle` + `separator`). The modern Field pattern integrates with RHF via plain `register()` + `aria-invalid` on the control + `data-invalid` on `<Field>` — no FormProvider context, no shared error helper. Per the shadcn skill's `rules/forms.md`: **"Forms use `FieldGroup` + `Field`. Never use raw `div` with `space-y-*` or `grid gap-*` for form layout."**
- [x] ~~Landed `src/lib/actions/form-bind.ts`~~ — Deleted alongside `form.tsx`. The modern Field pattern doesn't need a setError-routing helper; RHF's `setError(fieldName, ...)` is called inline from the form's submit handler and `<FieldError>` reads `formState.errors[fieldName]` directly.
- [x] ~~Smoke: a tiny throwaway form in a sandbox route renders, submits to a no-op action, error path maps via `setError`~~ — deferred to Phase 3's real consumer (quote-composer) since the throwaway sandbox would just shadow the real wiring; the `bindFormError` helper has its mapping logic exercised when Phase 3's composer port lands.
- [x] `tsc + test` gate green (tsc clean, 757/759 PASS)

#### Phase 3: Port `quote-composer.tsx`
- [x] Confirm the in-flight RHF + zod work is committed — landed `f540c46` immediately before 0042 build kicked off
- [x] Replace raw `<input>` blocks with shadcn primitives — `NumberField` and `TextAreaField` helpers internally now use `<Field data-invalid>` + `<FieldLabel>` + `<Input>`/`<Textarea>` + `<FieldError>`/`<FieldDescription>` (NOT the classic `<FormField>` pattern — see Phase 2 v2 note); call sites unchanged
- [x] Replace the retrieval-bracket Controller+buttons with `<FieldSet>` + `<FieldLegend>` + `<ToggleGroup>` + `<ToggleGroupItem>` — Base UI's ToggleGroup uses array-shape `value` for single-mode (no `type="single"` prop like Radix's), so the Controller adapter maps `field.value` → `[String(field.value)]` and `onValueChange(arr)` → `Number(arr[0])` with 0 fallback
- [x] ~~Replace the in-house `<Combobox>` for dealer selection with shadcn's Combobox pattern (Command + Popover)~~ — **Deferred to Phase 5.** The in-house `combobox.tsx` is consumed by both `quote-composer.tsx` AND `people-admin.tsx` (a Phase 5 target). Attempted `shadcn add combobox --overwrite` broke `people-admin.tsx` (now uses the shadcn Combobox's `options`-less Base UI API). Reverted; the combobox swap lands in Phase 5 alongside the other primitives so both consumers move together.
- [x] Wrap the Inputs section in `<FieldGroup>` per the shadcn skill's `rules/forms.md` ("Never use raw `div` with `space-y-*` or `grid gap-*` for form layout"); the surrounding `<div className="flex flex-col gap-3">` stays as a section-level scaffold since it sits *above* the form fields (holds the section heading too)
- [x] Keep `setQuoteInputs` / `createQuote` Server Actions as submission target — submission path unchanged; `form.handleSubmit(values => { ... toLegacyResult(await action(fd)) ... })` already in place from the 0035 RHF refactor
- [x] Verified the live computed-line-items table still updates from `useWatch` — composer rendered on `/quotes/new?dealerId=1` via web-test; "Audience size" / "Event days" / "BDC calls" / "Letters" / "Digital" all rendered as spinbuttons; "Record retrieval bracket" ToggleGroup renders 5 toggle buttons (None/$100/$200/$300/$400); Textarea for travel notes + quote notes renders cleanly. **Combobox still uses in-house Radix-based component until Phase 5.**
- [x] `tsc + test` gate green (tsc clean, 757/759 PASS)

#### Phase 4: Port `dealer-form.tsx` + `booking-form.tsx`
- [x] `dealer-form.tsx`: full RHF + zod port. Replaced `@radix-ui/react-form` + `useActionState` with `useForm` + `form.handleSubmit` + `zodResolver`. Dropped the hand-rolled `useTouched` hook in favour of RHF's `mode: 'onTouched'`. Replaced raw `<input>` blocks with `<Field>` + `<FieldLabel>` + `<Input>` + `<FieldError>`. `valuesToFormData(values, id?)` adapts RHF values to the existing `createDealer`/`updateDealer` Server Action FormData contract. Native `<select>` kept for the 2-option status toggle (shadcn `<Select>` would be overkill).
- [x] `booking-form.tsx`: **partial port** — kept `useActionState` + native `<form action={formAction}>` because the auto-fill UX (dealer-pick → populate contact/phone/email unless touched) uses raw `useState` rather than form state; full RHF migration would mean restructuring auto-fill into `watch(dealerId)` + `setValue` calls + an external touched-fields tracker, which is significant code change for no UX win in this chunk. Primitive swap landed: raw `<input>` → `<Input>`, raw `<textarea>` → `<Textarea>`, local `Field` helper rewritten to use shadcn `<Field>` + `<FieldLabel>` underneath. Native `<select>` kept for all option lists (same rationale as dealer-form). Full RHF migration captured as a Phase 4 follow-up if/when the auto-fill behaviour evolves.
- [x] Both forms keep Server Actions as submission target — no TanStack Query, no client-side mutation hooks.
- [x] Server-side `{ error }` results: dealer-form surfaces via `toast.error` (form-level); booking-form same shape via the existing `useActionState` + `useEffect` toast handler. Per-field `setError` mapping deferred until a Server Action surfaces an actual field-shaped error payload (today they all return single-string `error`).
- [x] `tsc + test` gate green per file (tsc clean, 757/759 PASS)

#### Phase 5: Primitive sweep (dialog / combobox / tabs)
- [x] `pnpm dlx shadcn@latest add dialog combobox tabs --overwrite` — replaced in-house Radix-backed wrappers with shadcn 4.x Base UI versions (`@base-ui/react/dialog`, `@base-ui/react` Combobox, `@base-ui/react/tabs`). `command` and `popover` were already shadcn-shape from Phase 2/3, so not re-added.
- [x] Replace consumers of `@/components/ui/dialog` — 9 files ported: `dealers-admin.tsx`, `dealer-form.tsx` (DialogClose only), `orphan-auth-users.tsx`, `people-admin.tsx`, `production/row-actions.tsx`, `calendar/booking-form.tsx`, `calendar/calendar-view.tsx`, `msa-create-dialog.tsx`, `quote-composer.tsx` (two dialogs). Pattern: `<Dialog.Root open onClose={...}>` → `<Dialog open onOpenChange={...}>`; `<Dialog.Backdrop /> <Dialog.Panel>` → `<DialogContent>` (overlay rendered internally); `<Dialog.Title/Description/Close>` → `<DialogTitle/DialogDescription/DialogClose>`. Parameterless `onClose` callers got an `onOpenChange={(o) => { if (!o) closeFn(); }}` wrapper. The `max-w-[780px]` sizing on the availability panel mapped to `sm:max-w-[780px]` to compose with shadcn's `sm:max-w-sm` default; `max-w-4xl`/`max-w-lg` likewise prefixed with `sm:` so the responsive override actually wins.
- [x] Replace consumers of `@/components/ui/combobox` — both ports use Base UI's compositional API: `<Combobox items={...} itemToStringValue={...} itemToStringLabel={...} value={obj|null} onValueChange={obj|null}>` + `<ComboboxInput placeholder>` + `<ComboboxContent><ComboboxEmpty>…</ComboboxEmpty><ComboboxList>{(item) => <ComboboxItem value={item}>…</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox>`. quote-composer keeps its number-id mapping via `Number(item.value) | null`; people-admin keeps the per-link string-id shape. The separate placeholder/inputPlaceholder split collapsed (Base UI always shows the input) — used `inputPlaceholder` text.
- [x] Replace consumers of `@/components/ui/tabs` — `reports-tabs.tsx` (only consumer): `<Tabs.Root> / <Tabs.List> / <Tabs.Trigger> / <Tabs.Content>` → `<Tabs> / <TabsList> / <TabsTrigger> / <TabsContent>`. Props identical (`value`, `onValueChange`).
- [x] Keep `data-table.tsx` and `toaster.tsx` — left untouched per Decisions block.
- [x] Delete now-unused primitives — removed `src/components/ui/command.tsx` (cmdk-based, no longer referenced after combobox swap) and `pnpm remove cmdk @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-tabs`. `grep -rln "from '@/components/ui/command'\|@radix-ui/react-(dialog\|popover\|tabs)\|from 'cmdk'" src/` is empty.
- [x] `tsc + test` gate green (tsc clean, 757/759 PASS). `web-test` smoke deferred to chunk-end `/eval` per the post-0040 cadence.

#### Phase 6: Docs (wiki) + Radix Form removal
- [ ] Write `docs/wiki/forms.md`: schema first + `z.infer`, Server Action submission via `form.handleSubmit`, `setError` mapping for server-side field errors, `<FormField>` wrapper API, in-house vs shadcn primitive decision matrix, when to extend a shadcn component vs build new
- [ ] Cross-link from `docs/wiki/index.md` and `docs/wiki/conventions.md`; append entry to `docs/wiki/log.md`
- [ ] Confirm `grep -rl '@radix-ui/react-form' src/` is empty
- [ ] `pnpm remove @radix-ui/react-form`
- [ ] Verify build still green; commit the docs + remove together

#### Phase 7: Tests + smoke verification
- [ ] Full `pnpm test` run — all existing form-touching tests still pass (dealer-form action tests, calendar booking-form tests, quote-composer tests if any)
- [ ] Smoke (web-test): `goto /dealerships`; click `+ Add Dealer`; dialog "Add Dealer" with fields `Dealership name` / `Contact first` / `Contact last` / `Email` / `Phone` / `Address` / `Status` / `How did this dealer find us?` (the same shape Radix Form was rendering — shadcn port is visual parity)
- [ ] Smoke (web-test): `goto /calendar`; click `+ Book Event`; dialog renders with the booking-form fields (dealer, campaign, date, etc. — match the current field list)
- [ ] Smoke (web-test): `goto /quotes/new?dealerId=1`; left-pane input fields render via `<FormField>`; right-pane computed table still updates as inputs change
- [ ] Full `/eval` at chunk-end (single pass per post-0040 `/build` cadence — fast `tsc + test` per phase, Codex + web-test + lint at chunk-end only)
