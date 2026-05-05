# Active design

**Plan:** [`docs/designs/0004-port-migration/plan.md`](0004-port-migration/plan.md) — umbrella tracker for the legacy `deprecated/index.html` → Next.js port

**Active sub-plan:** Proper user system → [`0018-user-system/plan.md`](0018-user-system/plan.md) — *outside* the port-migration umbrella; cross-cutting work that subsumes 0017 and adds RBAC enforcement, contact-user linkage, coach auto-filter, role-aware login routing.

**Parked:**
- Phase 5.7 — Booking summary & reports → [`0014-summary-reports/plan.md`](0014-summary-reports/plan.md)
- Phase 5.8 — Full-calendar share link → [`0010-calendar-share-full/plan.md`](0010-calendar-share-full/plan.md)
- CSV-injection mitigation + print-overlay leak (Codex medium + lows from 5.6) → not yet scaffolded; pull a small chunk if/when revisited.
- Book Your Event public intake + marketing-site cutover → [`0016-book-your-event-intake/plan.md`](0016-book-your-event-intake/plan.md) — *outside* the port-migration umbrella; new entry-point work surfaced after `salesability.ca/book-your-event` was confirmed as the planned entry point (see `project_entry_point.md` memory + open-questions.md Q10).
- ~~User admin (in-app `/admin/users`)~~ → [`shipped/0017-user-admin/plan.md`](shipped/0017-user-admin/plan.md) — **superseded** by `0018-user-system` on 2026-05-05; folded into Phase 1.
- Secure architecture (RLS defence-in-depth + sensitive-op audit log) → [`0019-security-architecture/plan.md`](0019-security-architecture/plan.md) — **depends on `0018` Phase 1+2** for the role taxonomy + `requireRole` helper; parked behind 0018 in the queue.

**Status:** `0018-user-system` scaffolded 2026-05-05 — phases not yet started.

---

This file is the pointer to the plan currently being worked on. It exists because saying "the plan" or "read the plan" is ambiguous when `docs/designs/` has many folders. See the **Tracking the active design** section in `CLAUDE.md` for the convention.

## History

For the raw "when was X active" — `git log -- docs/designs/CURRENT.md` shows every transition as a separate commit (since this file is tracked as of `bc450ad`). Reach for that first if you just need sequencing.

The bullets below are a *curated* layer over that log: same dates, but with the eval verdict, why the slot vacated, what got requeued, etc. — the context a commit message wouldn't carry. When the active plan or sub-plan changes, prepend a one-line entry (newest first) noting date, what changed, where it ended up (Done → `shipped/`, Paused, Abandoned), and any non-obvious context.

- **2026-05-05** — Scaffolded `0019-security-architecture/plan.md` (RLS defence-in-depth + sensitive-op audit log + per-action role audit + email-send hardening + MFA enablement). Parked behind 0018 since it depends on the role taxonomy + `requireRole` helper that 0018 establishes. Surfaced after a discussion of the Drizzle-direct-vs-PostgREST trade-off — the staff app's drift from the original "Drizzle owns SQL, supabase-js owns RLS-bound reads" intent (`0002-nextjs-scaffold/decision.md:10`) is now an explicit re-alignment plan.
- **2026-05-05** — Scaffolded `0018-user-system/plan.md` and picked it up as the active sub-plan. Subsumes the parked `0017-user-admin` (which was unstarted) and extends to RBAC enforcement, contact-user linkage, coach auto-filter, role-aware login routing. Surfaced while provisioning Tilley Shaye and discussing the legacy `Users!A:E` parity gap. 0017 stays in Parked as `subsumed`; will be moved to `shipped/` with a supersession note when 0018's Phase 6 ships.
- **2026-05-04** — `0015-calendar-grid-clamp` → Done; sub-plan moved to `shipped/0015-calendar-grid-clamp/`. Eval-smoke PASS with warnings on 2026-05-04: 44/44 tests, tsc clean, lint clean (4 pre-existing warnings); browser smoke green across both phases plus cross-month visual smoke run on dev DB (throwaway fixture inserted via `scripts/calendar-clamp-smoke.ts`, both leading and trailing clamped ribbons rendered correctly across April/May/June 2026, cleanup verified). Codex Low (test gap for prior-month-strip-only and next-month-strip-only overlaps) closed in the same commit. Throwaway smoke script deleted with ship. Active sub-plan slot vacated.
- **2026-05-03** — Picked `0015-calendar-grid-clamp` off Parked → in flight. Code + unit tests landed in working tree; visual smoke pending (needs a cross-month-boundary fixture in Supabase, deferred until user confirms it's OK to insert + remove).
- **2026-05-03** — Scaffolded `0017-user-admin/plan.md` for the in-app User Admin page (replaces dashboard-only provisioning). Parked. Surfaced while manually provisioning Shannon — clear UX win for adding the rest of the team.
- **2026-05-03** — Scaffolded `0016-book-your-event-intake/plan.md` for the public-intake + marketing-site cutover work. Parked outside the port-migration umbrella (new entry-point work, not a 5.x phase).
- **2026-05-03** — Deployed HEAD `5825971` to Cloud Run revision `event-manager-pro-00003-drf` (100% traffic). URL: https://event-manager-pro-248904507231.northamerica-northeast1.run.app. Bundle includes Phase 5.6 export+print, SaleDay logo + favicon (RGBA-fixed), Drizzle HMR cache, docs/ tracking change.
- **2026-05-03** — Phase 5.6 (Production export + print) → Done in commit `2a42c93`; pushed to `origin/main`; sub-plan moved to `shipped/0013-production-export/`. Eval-smoke PASS with warnings (1 medium CSV-injection + 3 low — captured in eval-2026-05-03-1024.md, parked for follow-up). Active sub-plan slot vacated; queued options remain 5.7 / 5.8 / slot-pack clamp.
- **2026-05-03** — Phase 5.6 (Production export + print) picked from Parked → in flight at `0013-production-export/plan.md`.
- **2026-05-01** — Phase 5.5 (Email send, Resend) → Done in commit `f963da7`; sub-plan moved to `shipped/0011-email-send/`. Removed from Parked. Active sub-plan slot remains vacated; queued options now 5.6 / 5.7 / 5.8 / slot-pack clamp.
- **2026-05-01** — Phases 5.3 (Lookup admin) and 5.4 (Availability admin) → Done in commit `023ee01`; both sub-plans moved to `shipped/`. Removed from Parked. Active sub-plan slot remains vacated; queued options updated.
- **2026-05-01** — Phase 5.2 (Campaign CRUD) → Done; sub-plan moved to `shipped/0008-campaign-crud/`. Active sub-plan slot vacated; queued options listed under Parked.
