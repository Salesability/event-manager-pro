# Catalyst migration mapping (Phase 1 working note)

This doc maps every current shadcn / Base UI / standalone-Radix callsite to its Catalyst counterpart so Phases 3–5 have a single reference for the primitive swap. **Audit run 2026-05-13** against branch `0049-migrate-to-catalyst` (off `main` @ `f56609d`).

## Catalyst CSS-shape contract (confirmed from button.tsx, dialog.tsx, input.tsx)

Catalyst components read **Tailwind v4's `@theme` output directly**, via the `var(--color-<family>-<shade>)` form (e.g. `var(--color-zinc-500)`, `var(--color-blue-600)`). They do **NOT** read shadcn semantic tokens (`--primary`, `--accent`, `--muted`, `--card`, `--popover`). Implications:

- Phase 2's `globals.css` reshape **must** drop the shadcn semantic-token layer entirely — Catalyst won't render correctly while it's still in place, but it also won't read from it. The two layers are independent.
- The `brand` color family must be registered as a Tailwind v4 `@theme` family — `--color-brand-50` … `--color-brand-950` — to be consumable by Catalyst components.
- Per-component CSS custom props (`--btn-bg`, `--btn-border`, `--btn-icon`, `--btn-hover-overlay`, `--gutter`) are set inline via Tailwind arbitrary-property utilities `[--btn-bg:var(--color-zinc-600)]` etc. — they're component-local, not in `globals.css`. No global drain work needed for these.
- Catalyst components ship dark-mode classes. The app is light-only today (no `dark:` toggle); dark classes will be inert. This is fine.
- `<Button color="brand">` etc. won't work out-of-the-box — Catalyst's `button.tsx` colors map (`button.tsx:59-158`) lists 22 named colors but not `brand`. Phase 2 must **add a `brand` entry** to that map (and to `badge.tsx`'s equivalent) so callsites can reference `color="brand"`. This is a deliberate edit to the verbatim-copied file; record the diff in the Phase 2 commit.

## Primitive swap matrix

| Primitive | Current source | Catalyst target | Callsite count | Notes |
|-----------|---------------|-----------------|----------------|-------|
| Button | `src/components/ui/button.tsx` (cva variants) | `src/components/catalyst/button.tsx` (`color` / `outline` / `plain` props) | 2 callsite files | `variant="default"` → `color="brand"` (after Phase 2 brand entry); `variant="outline"` → `outline`; `variant="destructive"` → `color="red"`; `variant="ghost"` → `plain`; `size="..."` props **dropped** (no Catalyst equivalent) — callsites that depend on size will need ad-hoc `className` overrides |
| Badge | `src/components/ui/badge.tsx` (cva `success`/`warning`/`info` variants) | `src/components/catalyst/badge.tsx` (`color` prop, Catalyst named colors) | 1 internal callsite (`src/components/app/status-badge.tsx`) + wrappers in `src/features/*/<X>-status-badge.tsx` | `success` → `color="green"`; `warning` → `color="amber"`; `info` → `color="blue"`; `default` → `color="zinc"` |
| Dialog | `src/components/ui/dialog.tsx` (Base UI) | `src/components/catalyst/dialog.tsx` (Headless UI) | 9 callsite files | API shape differs — Catalyst exports `<Dialog>` / `<DialogTitle>` / `<DialogDescription>` / `<DialogBody>` / `<DialogActions>`. No separate `<DialogClose>` — close via the `onClose` prop on `<Dialog>` or buttons inside `<DialogActions>`. SSR semantics: Catalyst Dialog mounts via Headless UI `<Transition>` — content does **not** render on the server when `open={false}`, so hydration drift is unlikely (closes 0046 follow-up (b)'s class of concerns) |
| Combobox | `src/components/ui/combobox.tsx` (Base UI) | `src/components/catalyst/combobox.tsx` (Headless UI) | 2 callsite files (`quote-composer.tsx`, `people-admin.tsx`) — plan claimed 3 but `dealer-form.tsx` does **not** use Combobox; correction noted | Catalyst Combobox API differs — `<Combobox>` / `<ComboboxLabel>` / `<ComboboxOption>`. Search filtering is callsite-driven (Headless UI shape). May need a small adapter wrapper if the callsites are deeply tied to the current `<ComboboxInput>` / `<ComboboxList>` / `<ComboboxEmpty>` API |
| Input | `src/components/ui/input.tsx` (Base UI) | `src/components/catalyst/input.tsx` (Headless UI) | 6 callsite files | API close; type prop and forwardRef behavior preserved. `data-invalid` is the validation hook (replaces `aria-invalid` styling pathway) |
| Textarea | `src/components/ui/textarea.tsx` (Base UI) | `src/components/catalyst/textarea.tsx` (Headless UI) | 3 callsite files (booking-form, quote-composer, msa-create-dialog) | Same shape as Input swap |
| Field / FieldGroup / Label / ErrorMessage | `src/components/ui/field.tsx` (`Field`/`FieldGroup`/`FieldLabel`/`FieldError`) | `src/components/catalyst/fieldset.tsx` (`Fieldset`/`Legend`/`FieldGroup`/`Field`/`Label`/`Description`/`ErrorMessage`) | 6 callsite files | Rename: `FieldLabel` → `Label`, `FieldError` → `ErrorMessage`. New affordances available: `<Fieldset>` + `<Legend>` for grouping, `<Description>` for help text |
| Select (`@radix-ui/react-select`) | direct import in `people-admin.tsx` | `src/components/catalyst/listbox.tsx` (Catalyst's select equivalent) | 1 callsite (`people-admin.tsx`, dealer-link role select) | Catalyst Listbox is Headless UI's `<Listbox>` — different API from Radix Select |
| Checkbox (`@radix-ui/react-checkbox`) | direct import in `people-admin.tsx` | `src/components/catalyst/checkbox.tsx` | 1 callsite (`people-admin.tsx`, role-grant checkboxes) | Catalyst Checkbox supports `color` prop; can replace the custom `roleCheckboxClass` |
| DropdownMenu (`@radix-ui/react-dropdown-menu`) | direct imports in `app-nav.tsx` + `user-menu.tsx` | `src/components/catalyst/dropdown.tsx` | 2 callsite files | Catalyst exports `<Dropdown>` / `<DropdownButton>` / `<DropdownMenu>` / `<DropdownItem>` / `<DropdownHeader>` / `<DropdownDivider>` |
| Tabs | `src/components/ui/tabs.tsx` (Base UI) | **No Catalyst equivalent — gap** | 1 callsite (`reports-tabs.tsx`) | See gap decisions below |
| ToggleGroup | `src/components/ui/toggle-group.tsx` (Base UI) | **No Catalyst equivalent — gap** | 1 callsite (`quote-composer.tsx`) | See gap decisions below — build custom on Headless UI `<RadioGroup>` |
| DataTable | `src/components/ui/data-table.tsx` (TanStack + Base UI chrome) | restyle in-place to compose `src/components/catalyst/table.tsx` primitives | 0 import changes — same file, internal restyle | TanStack `useReactTable` row model preserved; `<table>` / `<thead>` / `<tr>` JSX rewritten via `<Table>` / `<TableHead>` / `<TableRow>` / `<TableCell>` |
| Toaster | `src/components/ui/toaster.tsx` (sonner) | **No Catalyst equivalent — gap, KEPT** | 11 callsite files | Sonner-based toaster stays as-is. Phase 7 must NOT delete this file. Mark it explicitly retained |
| Toggle (single, not group) | `src/components/ui/toggle.tsx` (Base UI) | unused | 0 direct callsites in `src/` (file exists but only `toggle-group.tsx` imports it) | Will be deleted alongside `toggle-group.tsx` once ToggleGroup is rebuilt on Headless UI `<RadioGroup>` |
| Popover | `src/components/ui/popover.tsx` (Base UI) | unused | 0 callsites — file is orphan in `src/components/ui/` | Delete in Phase 7 |
| Separator | `src/components/ui/separator.tsx` (Base UI) | unused — Catalyst has `divider.tsx` if needed later | 0 callsites in `src/` | Delete in Phase 7 |
| Label (standalone) | `src/components/ui/label.tsx` (Base UI) | superseded by Catalyst `fieldset.tsx`'s `<Label>` | only used internally by `ui/field.tsx` | Delete in Phase 5 alongside `field.tsx` |
| InputGroup | `src/components/ui/input-group.tsx` | superseded — Catalyst's `input.tsx` exports its own `<InputGroup>` | unknown — grep at Phase 3 swap time | Delete in Phase 5 if unused |

## Gap decisions (locked)

| Gap | Decision | Rationale |
|-----|----------|-----------|
| **DataTable** | Keep TanStack `useReactTable` row model; restyle by composing Catalyst `<Table>` primitives | Catalyst ships a styled `<Table>` but no row model. TanStack handles sorting/pagination/filtering — the chrome is what changes |
| **ToggleGroup** | Build custom on Headless UI `<RadioGroup>` at `src/components/catalyst/toggle-group.tsx` (locked 2026-05-13) | One callsite (`quote-composer.tsx`); pure Catalyst+Headless UI keeps the primitive layer clean. No retained shadcn file |
| **Toaster** | Keep `src/components/ui/toaster.tsx` (sonner) as the lone retained shadcn primitive | Catalyst doesn't ship a toaster; sonner is well-fitted and 11 callsites depend on it. Phase 7 explicitly preserves this file |
| **Tabs** | **NEW (surfaced 2026-05-13 during Phase 1 audit)** — Catalyst doesn't ship Tabs. One callsite (`reports-tabs.tsx`). Decision: build custom on Headless UI `<TabGroup>` / `<TabList>` / `<Tab>` / `<TabPanels>` / `<TabPanel>` at `src/components/catalyst/tabs.tsx`. Add to Phase 4's checklist | Same shape as the ToggleGroup decision — keep the primitive layer pure Catalyst+Headless UI. Headless UI ships `<TabGroup>` already, so it's a thin shape-mapping wrapper |

## Tailwind v4 reality check

- Repo Tailwind: `4.2.4` (confirmed via `pnpm list tailwindcss`).
- `globals.css:1`: `@import "tailwindcss";` — Tailwind v4 single-import shape. ✔
- Tailwind v4 default `@theme` provides every named-color family (`zinc`, `blue`, `green`, `amber`, etc.) at the `--color-<family>-<shade>` variable shape that Catalyst reads. No special config needed beyond adding `--color-brand-*`.
- New Catalyst deps added: `@headlessui/react@2.2.10`, `motion@12.38.0`. `clsx@2.1.1` was already present. `pnpm install` cleaned out transitive `date-fns@4.1.0` — verified `src/` has zero direct `date-fns` imports, so the prune is safe.

## Outstanding for Phase 2+

- Eyedropper `public/saledayevents-logo.jpg` for the `brand-500` seed (anchor: `#1a5fa8`).
- Generate OKLCH-spaced ramp; commit the generator script to `docs/chunks/0049-migrate-to-catalyst/palette.md` or `palette.mjs`.
- Add `--color-brand-50..950` to `@theme` in `globals.css`.
- Add a `brand:` entry to `button.tsx`'s `colors` map and `badge.tsx`'s equivalent so `<Button color="brand">` / `<Badge color="brand">` works.
- Add Phase 4 line for Tabs swap to `reports-tabs.tsx` (new — surfaced during this audit).
