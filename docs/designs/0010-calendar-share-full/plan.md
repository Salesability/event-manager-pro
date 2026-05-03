# Full-calendar share link — 2026-04-30

Stub for sub-plan 5.8 of `docs/designs/0004-port-migration/plan.md`. Phase 4 of the migration shipped per-coach share via `/share/coach/[id]`; the legacy `shareModal` (`deprecated/index.html:489–516`) also offered a **full-calendar share link** that shows every booking (no coach filter). Done = a stable, tokenized full-calendar share URL exists; the legacy `🔗 Share` toolbar opens a modal listing both the full link and the per-coach links, each with Copy and (after 5.5) Email buttons.

This is the smallest leftover; if 5.5 (email send) ships first, the share modal can fold in there.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Public route + middleware allowlist | Pending | - |
| 2: Share modal (toolbar trigger + listing) | Pending | - |
| 3: Verification (tsc + vitest + dev smoke) | Pending | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| TBD when chunk is picked up | TBD | Public route models on `src/app/share/coach/[id]/page.tsx:1`; middleware allowlist on `src/lib/supabase/middleware.ts:4`. |

**Conventions referenced:**
- `docs/wiki/auth.md` — `/share/...` paths bypass middleware via `PUBLIC_PATHS`. The full-calendar route follows the same pattern.
- `docs/wiki/conventions.md` — Reuse `<CalendarView mode="share"/>` (added in port-views Phase 4) — pass no coach filter for the full variant.

**Overall Progress:** 0% (0/3 phases complete)

**Note:**
- Path shape: `/share/calendar` (no token) or `/share/calendar/[token]` (token-gated). Decide based on whether we want revocable links — token-gated is mildly more work but matches `/share/coach/[id]` shape and lets us rotate without breaking the modal listing.
- The "Email" button per row depends on 5.5; until 5.5 ships, render the buttons disabled with a tooltip.

### Phase Checklist

#### Phase 1: Public route
- [ ] Decide token-gated vs path-stable. Default: token-gated, generated on demand and stored on a `share_links` table or stamped on a config row — TBD.
- [ ] Add `src/app/share/calendar/[token]/page.tsx` (or `/share/calendar/page.tsx` if path-stable).
- [ ] Add the path prefix to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts`.

#### Phase 2: Share modal
- [ ] `🔗 Share` toolbar button on `/calendar` opens a Dialog that lists the full link + each coach's link, each with Copy + (later) Email buttons.

#### Phase 3: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean.
- [ ] `pnpm dev` smoke: open the full link in incognito; confirms calendar renders without nav, all coaches' bookings visible.
