# Strategy

Forward-looking artifacts that anchor the long-horizon and near-term roadmap. Sits alongside `docs/wiki/` (state-of-the-system reference) and `docs/chunks/` (per-chunk plans) — strategy is neither, so it gets its own folder.

These are *aspirational* documents, not committed roadmap. Use them to confirm intent and sanity-check that current chunks fit the bigger picture, not as authority for what's been built.

## Documents

- [vision.md](vision.md) — **Long horizon.** May 2026 PRD for the three-module SaleDay Events Production Software platform (DataLoader + Production Console + Event Manager). Positions `event-manager-pro` (the scheduling app) as one piece of a larger platform.
- [roadmap.md](roadmap.md) — **Near term.** May 2026 platform roadmap. Written from the *legacy app's* perspective (Netlify + Google Sheets + vanilla JS), but the planned phases (Google Calendar integration, shareable production list, Quote/MSA/e-signature workflow) align directly with this repo's port-then-new-surface plan in [`docs/wiki/architecture.md`](../wiki/architecture.md).

## Maintenance

These docs are **import artifacts** — verbatim copies of source PRDs/roadmaps with a clarifying preamble at the top. Don't edit the body. If a fact in here goes stale, the right move is one of:

- File a wiki update (the wiki tracks current state — see if this changes anything in `docs/wiki/`)
- Scaffold a design chunk (if a planned phase becomes real work)
- Add a new strategy doc and let the old one stand as a historical snapshot

Do not silently rewrite the body of an imported PRD — the preamble + the import date is the contract.
