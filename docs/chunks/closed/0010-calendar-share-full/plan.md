# Calendar share UI — legacy parity — 2026-04-30

**Closed:** 2026-05-11 — **abandoned without shipping.** Phase 5.8 of `docs/chunks/closed/0004-port-migration/plan.md`. Per-coach share (`/share/coach/[id]`) shipped in port-migration Phase 4 covers the real use case; the full-calendar variant was deemed not worth the work. Plan body below stays as the historical record of the legacy-parity scope so future revivals (if "shareable read-only link" comes back per `docs/strategy/roadmap.md` Phase 2) have a starting point.

Stub for sub-plan 5.8 of `docs/chunks/closed/0004-port-migration/plan.md`.

The legacy `🔗 Share` toolbar button (`deprecated/index.html:275`) opens `shareModal` (`deprecated/index.html:489–518`) — a single dialog that hands the user **two kinds of URL**:

1. **Full Calendar (all events)** — readonly URL + Copy.
2. **Coach Personal Links** — one row per coach who has at least one assigned event, each row showing the coach's color dot, name, event count, readonly URL, Copy, and 📧 Email.

The empty state (no coaches yet have events) reads: *"No coaches assigned to events yet. Add coaches and book events first."* Helper copy at the top of the modal: *"Send a personalised link to each sales coach. When they open it, the calendar automatically shows only their assigned events — no login required."*

Per-coach share already shipped in port-views Phase 4 (`/share/coach/[id]`) and email-send Phase 5.5 wired the per-coach email server action (`sendCoachShareLinkEmail`, `src/features/email/actions.ts:111`). What's missing is **(a)** the full-calendar route, and **(b)** the modal that surfaces both URLs from inside the app — today there is no UI affordance to discover a share link.

**Done =**
- A `🔗 Share` button on the `/calendar` toolbar opens a dialog matching the legacy layout (helper copy → full-calendar row with Copy → divider → per-coach list with Copy + Email per row → empty state when no coach has events).
- The full-calendar URL resolves to a public page that renders every booking with no coach filter (using `<CalendarView mode="share" />`).
- Per-coach rows reuse the existing `/share/coach/[id]` route and `sendCoachShareLinkEmail` server action.
- The full-calendar route is in `PUBLIC_PATHS` and renders without auth in incognito.

## Decisions (locked, with rationale)

1. **Path shape: `/share/calendar` (path-stable, no token).** Matches the bare `/share/coach/[id]` shape already in use, matches legacy parity (legacy used `window.location.href` — no token), and there's no current requirement to revoke a leaked link. Tokenization is a one-migration retrofit if revocation becomes real.
2. **No full-calendar email button.** Legacy only emailed per-coach links; the dialog has Copy on the full-calendar row only. Keeps scope tight; trivial to add later.
3. **Branding-neutral modal copy.** The share *page* (under `/share/coach/[id]`) currently shows the SaleDay logo, which is downstream of Q10 in `0004-port-migration/open-questions.md` (SaleDay vs Salesability mark). The *modal* itself uses no brand string, so it's safe to ship before Q10 lands; the page header re-skins independently.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Full-calendar public route + middleware allowlist | Pending | - |
| 2: `🔗 Share` toolbar button + share dialog (legacy-parity layout) | Pending | - |
| 3: Verification (tsc + vitest + dev smoke in incognito) | Pending | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/app/share/calendar/page.tsx` | `src/app/share/coach/[id]/page.tsx:14` | Sibling public share page; same data loaders, same `<CalendarView mode="share" />` render, same `bg-cream` + `bg-navy` shell. The full variant simply drops the coach filter. |
| `PUBLIC_PATHS` update | `src/lib/supabase/middleware.ts:4` | Existing array literal; one-line addition (`'/share/calendar'`). The prefix-match check at `:7` already handles `/share/calendar` exactly with no extra logic. |
| `🔗 Share` toolbar button | `src/app/(app)/calendar/calendar-view.tsx:440` | Existing `mode === 'app'` toolbar block where Block Date / Book Event live; add a third button before the month-stepper. Render only in `mode === 'app'` (the share page itself shouldn't show its own share button). |
| Share dialog branch | `src/app/(app)/calendar/calendar-view.tsx:577` | Existing `<Dialog.Root>` / `<Dialog.Panel>` block; add a `dialog.kind === 'share'` arm. The discriminated union at `:93` (`useState<DialogState>`) is the pattern — extend `DialogState` with `{ kind: 'share' }`. |
| `usedCoachIds` reuse | `src/app/(app)/calendar/calendar-view.tsx:487` | Already computed for the coach-filter pills; the modal needs the same set (coaches with ≥1 event). No duplicate derivation needed. |
| Per-coach Email button handler | `src/app/(app)/calendar/event-detail.tsx:9` | Existing pattern for calling email server actions from a Dialog with toast feedback. Wraps `sendCoachShareLinkEmail` (`src/features/email/actions.ts:111`) in a `useTransition` + `toast.success`/`toast.error`. |
| Color dot | `src/app/(app)/calendar/calendar-view.tsx:498` | `getCoachColor(cid).bg` already used for the filter pills; reuse the same helper for the share-row dots so colors match the calendar grid. |

**Conventions referenced:**
- `docs/wiki/auth.md` — `/share/...` paths bypass middleware via `PUBLIC_PATHS`. The full-calendar route follows the same pattern as `/share/coach`.
- `docs/wiki/conventions.md` — Reuse `<CalendarView mode="share" />` (added in port-views Phase 4) — pass no `forcedCoachId` for the full variant; the component already hides app-only toolbar buttons in `share` mode.
- `docs/wiki/architecture.md` — Email action runs as a Server Action (already does, in `src/features/email/actions.ts`); no new route handler needed.

**Overall Progress:** 0% (0/3 phases complete)

**Note:**
- The Email button in legacy was per-coach only — keep that. A "📧 Email me the full calendar" affordance is out of scope for parity.
- The share page header at `src/app/share/coach/[id]/page.tsx:41–55` will be reused verbatim for the full-calendar page (logo + tagline; just swap the per-coach line for "Master schedule — all booked sales events" or similar). The brand image inside that header tracks Q10 separately.

### Phase Checklist

#### Phase 1: Full-calendar public route
- [ ] `src/app/share/calendar/page.tsx` — load coaches + campaigns + blocks (range = current year ±1, mirroring `/share/coach/[id]/page.tsx:19-21`); filter only `status !== 'cancelled'`; render `<CalendarView mode="share" coaches={coaches} campaigns={campaigns} blocks={blocks} />` (no `forcedCoachId`).
- [ ] Header reuses the SaleDay shell from the per-coach page; subtitle reads "Master schedule — all booked sales events" (or whatever copy lands once Q10 is resolved).
- [ ] Add `'/share/calendar'` to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts:4`.
- [ ] Smoke: `pnpm dev`, open `/share/calendar` in an incognito window, confirm no auth redirect and full grid renders.

#### Phase 2: Toolbar button + Share dialog
- [ ] Extend `DialogState` in `calendar-view.tsx:93` with `{ kind: 'share' }`.
- [ ] Add `🔗 Share` button to the toolbar block at `:440` (only when `mode === 'app'`); `onClick` → `setDialog({ kind: 'share' })`.
- [ ] Add `dialog.kind === 'share'` arm in the Dialog block at `:577`. Layout:
  - Header: "Share Calendar".
  - Helper paragraph: "Send a personalised link to each sales coach. When they open it, the calendar automatically shows only their assigned events — no login required." (verbatim from legacy.)
  - Full Calendar row: label "Full Calendar (all events)", readonly input pre-filled with `${origin}/share/calendar`, Copy button (`navigator.clipboard.writeText` + `toast.success("Full calendar link copied!")`).
  - Divider.
  - Coach Personal Links section: one row per id in `usedCoachIds` — color dot + `${first} ${last}` + `${count} event${count===1?'':'s'}` + readonly input with `${origin}/share/coach/${id}` + Copy + 📧 Email.
  - Empty state when `usedCoachIds.length === 0`: "No coaches assigned to events yet. Add coaches and book events first."
  - Footer: Close button.
- [ ] Per-coach Email button: `onClick` → `useTransition` form-submit calling `sendCoachShareLinkEmail` with `coachId` field; toast success/error using the pattern from `event-detail.tsx`.
- [ ] `origin` derivation: client-side, use `typeof window !== 'undefined' ? window.location.origin : ''` (the dialog only renders client-side anyway, so SSR placeholder doesn't matter).

#### Phase 3: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean.
- [ ] `pnpm dev` smoke:
  - Toolbar `🔗 Share` opens the dialog; full-calendar Copy puts the right URL on the clipboard.
  - With at least one coach-assigned event in dev DB: per-coach row shows correct color, name, count; Copy works; Email triggers a toast and (in non-prod) hits the dev redirect address.
  - With zero coach-assigned events: empty state copy renders.
  - Both `/share/calendar` and `/share/coach/[id]` render in an incognito window without auth.
