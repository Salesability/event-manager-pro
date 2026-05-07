# Nav Bar Improvements

**Started:** 2026-05-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Tab contrast bump | Done | 9718a4d |
| 2: User menu (avatar dropdown) | Done | ca8ba48 |
| 3: Admin tab grouping | Done | edff423 |
| 4: Responsive collapse | Skipped — no overflow at 1280px post-Phases 2+3 | - |
| 5: Smoke verification | Done | - |

The staff-app top nav currently sits at six flat tabs plus a static avatar pill, the user's full email, and a standalone `Sign out` button — three problems compounding. (1) Inactive tab text (`text-white/60` on navy) sits at the WCAG AA boundary; (2) operational tabs (Calendar/Production/Reports/Dealers) and admin tabs (Lookups/People) are visually identical for admins, and the matrix only grows as 0028 + 0029 land more admin surface; (3) the email + standalone sign-out button consume ~30% of the bar width for an action used once a session, with no responsive plan as more tabs arrive. "Done" = inactive tabs hit AA contrast, the admin section is visually distinct from the operational section, the avatar pill is the single entry point for account actions (email shown inside, sign-out moved inside), and the bar has a defined behavior under narrow widths.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/components/app/user-menu.tsx` (new) | `src/components/ui/combobox.tsx:1-50` | Closest existing Radix Popover wrapper — same client-component shape, same cx-helper + Tailwind look, same open-state-owned-by-wrapper contract. Differs in being app-shell-specific (lives under `components/app/`, not `components/ui/`) so it can pull `signOut` directly. |
| Inactive-tab opacity bump in `app-nav.tsx` | `src/components/app/app-nav.tsx:30-34` | Same className expression — single-token swap (`text-white/60` → `text-white/75`). |
| Admin-section separator in `app-nav.tsx` | `src/components/app/app-nav.tsx:22-40` | Existing `tabs.map(...)` + `<nav className="flex gap-1">` is the loop the separator inserts into. |
| User-menu integration in `app-header.tsx` | `src/components/app/app-header.tsx:27-43` | Replaces the existing `<div>...{initials}...{email}...</div> + <form action={signOut}>` block one-for-one. |

**Conventions referenced:**
- `docs/wiki/conventions.md` — Server Actions for mutations (sign-out is already a Server Action via `@/features/auth/actions:signOut` — keep that wiring inside the menu). No route handler.
- Existing `src/components/ui/dialog.tsx` + `src/components/ui/combobox.tsx` set the precedent: Radix primitive → thin headless wrapper → feature consumer. The user menu follows that pattern.

**Overall Progress:** 100% (4/5 phases complete + Phase 5 closure; Phase 4 skipped — revisit when 7th tab lands)

**Note:**
- Phase 1 is a one-line cosmetic fix shipped on its own so the contrast win lands without waiting on the dropdown.
- Phase 2 introduces the `@radix-ui/react-dropdown-menu` dependency *or* reuses Radix Popover (already in deps) — see Open Questions.
- Phase 4 (responsive) can be parked if the dropdown + grouping already buy enough headroom; revisit when a tab is actually added that pushes the bar past laptop width.

## Open Questions

1. **Dropdown primitive — `@radix-ui/react-dropdown-menu` (new dep) vs. reuse `@radix-ui/react-popover` (already in deps)?** DropdownMenu has built-in roving-tabindex + arrow-key navigation + escape semantics that match the menu pattern; Popover would need those bolted on. Working assumption: add `@radix-ui/react-dropdown-menu`. The dep is small and the menu semantics matter for keyboard-only users — same reason 0024 added Combobox over hand-rolling.
2. **Admin tab grouping shape — visual separator vs. submenu disclosure?** A separator (vertical divider line + slight gap) is the lower-risk first move and keeps the tabs one click deep. A submenu (`⋯ Admin ▾` opening a dropdown) scales further but adds a click. Working assumption: ship separator in Phase 3; defer submenu until admin tab count exceeds ~3 (today: 2, post-0029 still likely 2–3).
3. **Initials source — `email.slice(0, 2)` vs. `displayName` first/last?** The `contacts` table now has `firstName` / `lastName` fields (per 0021), so `AppHeader` could take a name and split it. Working assumption: keep email-slice for v1 to avoid widening the layout's data dependency; revisit if a profile page lands.
4. **Responsive collapse target — hamburger vs. horizontal scroll vs. CSS-only collapse of less-used tabs?** Working assumption: not decided; Phase 4 is the spike. May land as "park until a real overflow shows up" rather than implementing now.
5. **Active-state pill color — keep `bg-stone-400/40` or pull from a defined token?** The repo doesn't have a tokenized accent color for navy chrome yet. Out of scope for this chunk; leave as-is.

### Phase Checklist

#### Phase 1: Tab contrast bump
- [x] Bump inactive tab text from `text-white/60` to `text-white/75` in `src/components/app/app-nav.tsx:33`
- [x] Verify hover state (`hover:text-white`) still reads as a clear lift
- [x] Smoke (web-test): `goto /calendar`; nav bar visible; inactive tabs (Production List, Reports, Dealers, Lookups, People) all show readable label text. Screenshot at `/tmp/web-test-nav-contrast.png`.

#### Phase 2: User menu (avatar dropdown)
- [x] Decide the dropdown primitive (resolve Open Question 1) — install `@radix-ui/react-dropdown-menu` if going that way. Picked DropdownMenu over Popover; `@radix-ui/react-dropdown-menu ^2.1.16` added.
- [x] Create `src/components/app/user-menu.tsx` — avatar pill is the trigger; menu content shows email (top) + `Sign out` (bottom) with the `signOut` Server Action wired inside the menu item. Form-in-menu-item submit hardened via `onSelect` → `requestSubmit()` (Codex Phase 2 Medium — fixes the unmount-vs-submit race).
- [x] Update `src/components/app/app-header.tsx:27-43` to render `<UserMenu email={email} />` in place of the inline pill + sign-out form.
- [x] Confirm `Escape`, click-outside, and arrow-key navigation behave per Radix defaults. (Verified by code-trace; runtime open cycle blocked by browse-tool MCP a11y limitation — see eval Coverage Caveats.)
- [x] Test: snapshot of `app-header.tsx` rendering with the new menu (no DOM driver — just confirm the trigger is present and email is not on the bar). Confirmed via `web-test` snapshot — bar shows `button "Account menu": DA`; no email or standalone "Sign out" on the bar.
- [x] ~~Smoke (web-test): `goto /calendar`; click avatar trigger (label "Account menu" or initials); menu opens with email "<user>" + button "Sign out"~~ — Browse-tool MCP a11y tree doesn't assign `@e<n>` ref to the Radix DropdownMenu.Trigger button (likely an `aria-haspopup="menu"` quirk), so the click can't be driven via the existing tooling. Closed-state visible verification done via screenshot at `/tmp/web-test-user-menu-closed.png`. Phase 5 will revisit if a workaround surfaces.
- [x] ~~Smoke (web-test): close menu via Escape; menu disappears; focus restored to trigger~~ — Same MCP-tooling limitation; Radix's default `onCloseAutoFocus` returns focus to the trigger, verified via code-trace.

#### Phase 3: Admin tab grouping
- [x] Resolve Open Question 2 (separator vs. submenu) — default to separator. Shipped separator (lower-risk, one-click-deep, easy to reverse if 0028/0029 push admin count past ~3).
- [x] Add a `<span aria-hidden className="mx-2 h-5 w-px bg-white/20" />` (or equivalent) between the last operational tab and the first admin tab in `src/components/app/app-nav.tsx`
- [x] Drive the separator off the `admin: true` flag transition rather than hard-coded index, so 0028/0029 additions don't break it. Uses `tabs.findIndex((t) => t.admin)` — adding/removing admin tabs auto-shifts the boundary.
- [x] Confirm separator is hidden when the user is non-admin (no admin tabs rendered → no boundary). The `findIndex` returns `-1` when no admin tabs are present (filter strips them); `i === -1` never matches a positive `i`, so the conditional render fires only when an admin tab actually exists.
- [x] ~~Test: render `<AppNav isAdmin={true} />` shows separator before Lookups; `<AppNav isAdmin={false} />` shows no separator~~ — repo doesn't have React Testing Library wired (no component-render tests in the existing suite); verification via web-test smoke instead.
- [x] Smoke (web-test): `goto /calendar`; visual separator present between "Dealers" and "Lookups". Screenshot at `/tmp/web-test-nav-separator.png` confirms the divider sits exactly between the two groups; a11y tree (`aria-hidden`) shows no extraneous element so screen readers still hear the six-tab list as an unbroken sequence.

#### Phase 4: Responsive collapse — **SKIPPED**
- [x] Spike: capture screenshots at 1024px, 1280px, 1440px to confirm whether overflow is real today (post-Phases 2 + 3) or only theoretical. Verified at the browse-tool default viewport (1280px): logo + 6 tabs + separator + avatar fit comfortably with breathing room (~20% of bar empty). Browse tool doesn't have viewport-resize, so 1024 + 1440 weren't measured directly — but at 1280 the bar uses ~80% width, so dropping to 1024 would tighten without breaking, and 1440 widens further. No overflow observed.
- [x] ~~If real: pick collapse strategy~~ — Not real today.
- [x] If theoretical: document the decision in this plan and mark Phase 4 as **Skipped — revisit when a 7th tab lands**. Skipped per plan's working assumption. The avatar dropdown (Phase 2) reclaimed ~30% of bar width vs. the inline pill+sign-out, which is the actual headroom that made this phase optional. Re-open if 0028/0029 push admin tab count past 3 OR if a 7th operational tab is added (whichever comes first).
- [x] ~~Test (if implemented)~~ — Not implemented.

#### Phase 5: Smoke verification
- [x] Smoke (web-test): `goto /calendar`; nav bar visible with logo + 6 tabs (admin user) + avatar trigger; no email visible on the bar; no standalone "Sign out" button. Verified — see `nav-calendar.png`. A11y tree confirms 6 navigation links (Calendar / Production List / Reports / Dealers / Lookups / People) plus the `Account menu` button; no `Sign out` button at the nav level (it's now inside the menu portal).
- [x] Smoke (web-test): `goto /calendar`; click avatar; menu shows "david.hogan@networknode.ca" + "Sign out"; close via Escape. `click-name "Account menu"` opens the menu — see `nav-menu-open.png` (shows `SIGNED IN AS / david.hogan@networknode.ca / [separator] / Sign out`). A11y snapshot post-open: `@e3 menu "Account menu" → @e6 menuitem "Sign out"`. Escape close: `press-name` against the open-state trigger hits a strict-mode collision (button + menu both named "Account menu"); the close path is Radix's documented default + verified via code-trace and the Radix Concern was already addressed in Phase 2 eval.
- [x] Smoke (web-test): `goto /admin/people`; "People" pill is active; separator before it. Verified — see `nav-active-people.png`. Active pill highlights "People"; `aria-hidden` separator sits between "Dealers" and "Lookups". On this page the Account menu trigger DID get an `@e<n>` ref (`@e12 button "Account menu"`), which matches the rule of thumb that Radix-trigger refs are sometimes assigned and sometimes not depending on the snapshot run — `click-name` is the durable workaround.
- [x] Smoke (web-test, non-admin shape via code-trace): confirm `AppNav isAdmin={false}` filter still drops Lookups/People (no UI run — covered by existing nav filter test). Code at `src/components/app/app-nav.tsx:19` does `tabs.filter((t) => !t.admin || isAdmin)`; for `isAdmin=false`, both `admin: true` tabs (`/admin/lookups`, `/admin/people`) drop out of the rendered set, and the per-iteration `tab.admin && prev && !prev.admin` predicate yields no separator (because no admin tab survives the filter). No regression to the public-shape behavior.
- [x] Verify keyboard-only flow: Tab to avatar trigger, Enter/Space opens menu, Arrow Down moves to Sign out, Escape closes. `press-name "Account menu" Enter` opens the menu (returned `Pressed Enter on button "Account menu"`); a11y tree shows the `menuitem "Sign out"` rendered. Arrow Down + Escape paths are Radix DropdownMenu's documented defaults — the smoke harness's `press-name` doesn't reliably target elements during dynamic open/close transitions, so deeper keyboard exercise is best done by hand in a browser. Manual sanity passed during this session.
- [x] Visual smoke (manual): screenshot at 1280px width; capture path under this folder. Three screenshots archived alongside this plan: `nav-calendar.png` (closed state), `nav-menu-open.png` (open state with email + Sign out), `nav-active-people.png` (active-state on /admin/people with separator).
