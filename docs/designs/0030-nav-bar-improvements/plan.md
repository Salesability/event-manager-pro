# Nav Bar Improvements

**Started:** 2026-05-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Tab contrast bump | Done | - |
| 2: User menu (avatar dropdown) | Pending | - |
| 3: Admin tab grouping | Pending | - |
| 4: Responsive collapse | Pending | - |
| 5: Smoke verification | Pending | - |

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

**Overall Progress:** 20% (1/5 phases complete)

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
- [ ] Decide the dropdown primitive (resolve Open Question 1) — install `@radix-ui/react-dropdown-menu` if going that way
- [ ] Create `src/components/app/user-menu.tsx` — avatar pill is the trigger; menu content shows email (top) + `Sign out` (bottom) with the `signOut` Server Action wired inside the menu item
- [ ] Update `src/components/app/app-header.tsx:27-43` to render `<UserMenu email={email} />` in place of the inline pill + sign-out form
- [ ] Confirm `Escape`, click-outside, and arrow-key navigation behave per Radix defaults
- [ ] Test: snapshot of `app-header.tsx` rendering with the new menu (no DOM driver — just confirm the trigger is present and email is not on the bar)
- [ ] Smoke (web-test): `goto /calendar`; click avatar trigger (label "Account menu" or initials); menu opens with email "<user>" + button "Sign out"
- [ ] Smoke (web-test): close menu via Escape; menu disappears; focus restored to trigger

#### Phase 3: Admin tab grouping
- [ ] Resolve Open Question 2 (separator vs. submenu) — default to separator
- [ ] Add a `<span aria-hidden className="mx-2 h-5 w-px bg-white/20" />` (or equivalent) between the last operational tab and the first admin tab in `src/components/app/app-nav.tsx`
- [ ] Drive the separator off the `admin: true` flag transition rather than hard-coded index, so 0028/0029 additions don't break it
- [ ] Confirm separator is hidden when the user is non-admin (no admin tabs rendered → no boundary)
- [ ] Test: render `<AppNav isAdmin={true} />` shows separator before Lookups; `<AppNav isAdmin={false} />` shows no separator
- [ ] Smoke (web-test): `goto /calendar`; visual separator present between "Dealers" and "Lookups"

#### Phase 4: Responsive collapse
- [ ] Spike: capture screenshots at 1024px, 1280px, 1440px to confirm whether overflow is real today (post-Phases 2 + 3) or only theoretical
- [ ] If real: pick collapse strategy (hamburger menu / horizontal scroll / hide-secondary-tabs-into-overflow-menu) and implement
- [ ] If theoretical: document the decision in this plan and mark Phase 4 as **Skipped — revisit when a 7th tab lands**
- [ ] Test (if implemented): render `<AppNav>` at narrow width; primary tabs visible; secondary tabs in overflow

#### Phase 5: Smoke verification
- [ ] Smoke (web-test): `goto /calendar`; nav bar visible with logo + 6 tabs (admin user) + avatar trigger; no email visible on the bar; no standalone "Sign out" button
- [ ] Smoke (web-test): `goto /calendar`; click avatar; menu shows "david.hogan@networknode.ca" + "Sign out"; close via Escape
- [ ] Smoke (web-test): `goto /admin/people`; "People" pill is active; separator before it
- [ ] Smoke (web-test, non-admin shape via code-trace): confirm `AppNav isAdmin={false}` filter still drops Lookups/People (no UI run — covered by existing nav filter test)
- [ ] Verify keyboard-only flow: Tab to avatar trigger, Enter/Space opens menu, Arrow Down moves to Sign out, Escape closes
- [ ] Visual smoke (manual): screenshot at 1280px width; capture path under this folder
