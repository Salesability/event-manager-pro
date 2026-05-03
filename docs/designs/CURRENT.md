# Active design

**Plan:** [`docs/designs/0004-port-migration/plan.md`](0004-port-migration/plan.md) — umbrella tracker for the legacy `deprecated/index.html` → Next.js port

**Active sub-plan:** _None — pick a new one_

**Parked:**
- Phase 5.7 — Booking summary & reports → [`0014-summary-reports/plan.md`](0014-summary-reports/plan.md)
- Phase 5.8 — Full-calendar share link → [`0010-calendar-share-full/plan.md`](0010-calendar-share-full/plan.md)
- Calendar slot-pack clamp (Codex medium #1 deferred from 5.2) → [`0015-calendar-grid-clamp/plan.md`](0015-calendar-grid-clamp/plan.md)
- CSV-injection mitigation + print-overlay leak (Codex medium + lows from 5.6) → not yet scaffolded; pull a small chunk if/when revisited.

**Status:** Phase 5.6 (Production export + print) shipped 2026-05-03 in commit `2a42c93`; sub-plan moved to `shipped/0013-production-export/`. Pushed to `origin/main`. Awaiting next pick.

---

This file is the pointer to the plan currently being worked on. It exists because saying "the plan" or "read the plan" is ambiguous when `docs/designs/` has many folders. See the **Tracking the active design** section in `CLAUDE.md` for the convention.

## History

When the active plan or sub-plan changes, prepend a one-line entry below (newest first) noting the date, what changed, and where it ended up (Done → `shipped/`, Paused, Abandoned, etc.). `git log` shows file edits to this pointer; the narrative below tells you *which plan was active when* in one place, without having to chase commits.

- **2026-05-03** — Phase 5.6 (Production export + print) → Done in commit `2a42c93`; pushed to `origin/main`; sub-plan moved to `shipped/0013-production-export/`. Eval-smoke PASS with warnings (1 medium CSV-injection + 3 low — captured in eval-2026-05-03-1024.md, parked for follow-up). Active sub-plan slot vacated; queued options remain 5.7 / 5.8 / slot-pack clamp.
- **2026-05-03** — Phase 5.6 (Production export + print) picked from Parked → in flight at `0013-production-export/plan.md`.
- **2026-05-01** — Phase 5.5 (Email send, Resend) → Done in commit `f963da7`; sub-plan moved to `shipped/0011-email-send/`. Removed from Parked. Active sub-plan slot remains vacated; queued options now 5.6 / 5.7 / 5.8 / slot-pack clamp.
- **2026-05-01** — Phases 5.3 (Lookup admin) and 5.4 (Availability admin) → Done in commit `023ee01`; both sub-plans moved to `shipped/`. Removed from Parked. Active sub-plan slot remains vacated; queued options updated.
- **2026-05-01** — Phase 5.2 (Campaign CRUD) → Done; sub-plan moved to `shipped/0008-campaign-crud/`. Active sub-plan slot vacated; queued options listed under Parked.
