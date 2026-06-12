# Legacy → Next.js port — migration tracker — 2026-04-30

**Closed:** 2026-05-11 — umbrella shipped. 5.7 (Booking summary & reports) status corrected from stale `Pending` → `Done` (`155df20`, shipped 2026-05-07 via `closed/0014-summary-reports/`). **5.8 (Full-calendar share link) dropped without shipping** — per-coach share at `/share/coach/[id]` covers the real use case; the full-calendar variant was deemed not worth the work. The `0010-calendar-share-full/` sub-plan moved to `closed/` with an abandoned-without-shipping header on the same day. Folder moved to `docs/chunks/closed/` 2026-05-11.

Tracks progress against the migration order set in `docs/chunks/closed/0001-port-stack-analysis/notes.md`, with the data-model work split out as its own phase (it grew well past "empty tables matching today's columns" once the wiki STAR-aligned rewrite landed). Source of truth for the new system's shape lives in `docs/wiki/`. Done = the legacy feature surface is closed (Phase 5). The quote → contract → invoice → payment loop, the domain cutover, and legacy-secret rotation are all tracked outside this umbrella.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: App shell + auth | Done | `c80e6c2` |
| 2: Design and build data model | Done | `db67118` |
| 3: One-time Sheets → Postgres import | Done | `bff71fe` |
| 4: Port the three views (lists, production, calendar) | Done | `68ef580` |
| **5: Feature-parity gap-close (must precede cutover)** | | |
| &nbsp;&nbsp;5.1: Lists CRUD | Done | `60e80f8`, `942ba69`, `2bd779e`, `1b6358e`, `5fbf9f4`, `1c2b4bf` |
| &nbsp;&nbsp;5.2: Campaign CRUD (booking modal + event detail) | Done | `e729d9e`, `1feb1a3`, `1c8bb09`, `9647939`, `04225b5`, `3f5b655`, `c62bd52` |
| &nbsp;&nbsp;5.3: Lookup admin (event styles + data sources) | Done | `023ee01` |
| &nbsp;&nbsp;5.4: Availability admin (block-out dates) | Done | `023ee01` |
| &nbsp;&nbsp;5.5: Email send (Resend) | Done | `f963da7` |
| &nbsp;&nbsp;5.6: Production export + print | Done | `2a42c93` |
| &nbsp;&nbsp;5.7: Booking summary & reports | Done | `155df20` |
| ~~&nbsp;&nbsp;5.8: Full-calendar share link~~ | Dropped 2026-05-11 | — |

**Overall Progress:** 100% (11/11 active chunks complete; 5.8 dropped 2026-05-11 — per-coach share covers the use case)

**Note:**
- Phase order follows `docs/chunks/closed/0001-port-stack-analysis/notes.md` §"Migration order", with the data-model work pulled out into its own phase, and Phase 5 inserted to gap-close the legacy feature surface (Phase 4 only ported the three read-only views).
- The original Phase 7 (Q→C→I→P loop) was promoted to its own epic on 2026-05-07 — see [`../0025-quote-to-payment/plan.md`](../0025-quote-to-payment/plan.md) — because each leaf is its own external-integration chunk and the loop will outlive this port-migration tracker.
- The original Phase 6 (domain cutover) and Phase 8 (legacy-secret rotation + spreadsheet lockdown) were also dropped from this tracker on 2026-05-07 — those tasks live outside the port-migration umbrella.
- `docs/wiki/data-model.md` is the schema source of truth; `docs/wiki/auth.md`, `docs/wiki/architecture.md`, `docs/wiki/conventions.md` cover the rest.

### Phase Checklist

#### Phase 1: App shell + auth — Done
- [x] Next.js + Supabase + Drizzle scaffold (`7493fb8`)
- [x] Session middleware + `getUser` helper (`a65a745`)
- [x] Next 16 middleware → proxy rename (`aa1a732`)
- [x] Magic-link + Google OAuth, route gating, session banner (`c80e6c2`)
- [x] Vitest scaffolded with `safeNextPath` redirect tests (`dac0256`)

#### Phase 2: Design and build data model — Done
- [x] STAR Standard alignment: `contacts` as master *Party* root, `dealers` as *Dealer Profile*, `campaigns` as *Marketing Campaign*, etc. (see `docs/wiki/data-model.md` §preamble)
- [x] `docs/wiki/data-model.md` authored with full schema, relationships, dedup strategy, privacy notes, open questions
- [x] Schema files in `src/lib/db/schema/` rewritten to match the wiki: `contacts` (master), `team_member_roles`, `dealer_contacts`, `contact_identifiers`, `dealers`, `vehicles`, `vehicle_ownerships`, `campaigns`, `campaign_styles`, `sales_lead_sources`, `availability_blocks`
- [x] Drizzle migration regenerated as `0000_ambiguous_mister_fear.sql` (auth-schema gotcha stripped per `db-conventions`)
- [x] `pnpm test` and `pnpm tsc --noEmit` clean
- [x] Commit the schema rewrite + migration (`db67118`)

#### Phase 3: One-time Sheets → Postgres import
Detailed plan + decisions in `docs/chunks/closed/0005-sheets-import/{plan,notes}.md`.
- [x] Apply the schema migration to the Supabase project (via session pooler — direct connection is IPv6-only on free tier)
- [x] Seed `campaign_styles` and `sales_lead_sources` from the legacy data (`drizzle/0001_seed_lookups.sql`, idempotent)
- [x] Inventory Sheets ranges + decide Google auth path + decide Users/Clients/Events mappings (see `docs/chunks/closed/0005-sheets-import/notes.md` §Resolved)
- [x] Wrote `scripts/import-from-sheets.ts` (Coaches + Clients + Events importers, in-memory legacy_id maps, schema-era handling for Events)
- [x] Dry-run + verification + idempotency confirmed (see Phase 6 of `docs/chunks/closed/0005-sheets-import/plan.md`)
- [ ] Archive Sheets read-only — *out of scope for this tracker; tracked outside the umbrella alongside the dropped legacy-secret rotation*

#### Phase 4: Port the three views — Done
- [x] App shell + tab nav (`(app)/layout.tsx`, header, redirects `/` → `/calendar`)
- [x] Lists view — read-only dealers + coaches over Drizzle (`loadDealers`/`loadCoaches`)
- [x] Production view — campaigns table with debounced search + status filter via search params
- [x] Calendar view — verbatim port of legacy `renderCalendar` / `drawRibbons` slot-packing + ribbon overlay
- [x] `?coach=<id>` share URL behavior — implemented as path-based public route `/share/coach/[id]` (cleaner than middleware-bypass on `?coach=`)
- [x] Theme: navy/cream + DM Serif Display / DM Sans via Tailwind 4 `@theme`
- [x] Detailed checklist + commit anchors in `docs/chunks/closed/0006-port-views/plan.md`

#### Phase 5: Feature-parity gap-close
The Phase 4 port shipped the three read-only views; Phase 5 closes the remaining gaps from `deprecated/index.html` so the new app can fully replace it. Each row below is its own chunk with (or pending) a sub-plan under `docs/chunks/NNNN-<slug>/plan.md`.

Status/Commit per chunk live in the top-level Progress Tracker; this table is the chunk-detail reference (legacy line refs + sub-plan links).

| # | Chunk | Legacy reference | Plan |
|---|-------|------------------|------|
| 5.1 | Lists CRUD (dealers + coaches Add/Edit/Delete + primary contact) | lines 449–486, 1273–1437 | [`0007-lists-crud/plan.md`](../0007-lists-crud/plan.md) |
| 5.2 | Campaign CRUD: Booking modal + Event Detail + delete + Production row Edit/View | lines 283, 344–429, 1263–1264 | [`0008-campaign-crud/plan.md`](../0008-campaign-crud/plan.md) |
| 5.3 | Lookup admin: Manage Event Styles + Manage Data Sources (`campaign_styles`, `sales_lead_sources`) | lines 377, 387, 522–549 | [`0012-lookup-admin/plan.md`](../0012-lookup-admin/plan.md) |
| 5.4 | Availability admin: Block-out dates UI (`availability_blocks` CRUD) | lines 279, 579–599 | [`0009-availability-admin/plan.md`](../0009-availability-admin/plan.md) |
| 5.5 | Email send: Resend confirmation to client/coach + email coach share link | lines 424–425, 431–444, 1720 | [`0011-email-send/plan.md`](../0011-email-send/plan.md) |
| 5.6 | Production: Export CSV + Print | lines 307–308 | [`0013-production-export/plan.md`](../0013-production-export/plan.md) |
| 5.7 | Booking Summary modal: By Client / By Coach / By Month / Full Production Report + Print + Export CSV | lines 278, 552–574 | [`0014-summary-reports/plan.md`](../0014-summary-reports/plan.md) — Done 2026-05-07 |
| ~~5.8~~ | ~~Calendar share: full-calendar share link variant of `shareModal`~~ | ~~lines 489–516~~ | ~~[`0010-calendar-share-full/plan.md`](../0010-calendar-share-full/plan.md)~~ — **Dropped 2026-05-11** (per-coach share covers the use case) |

Sequencing:
- 5.2 (Campaign CRUD) is the prerequisite for the Q→C→I→P loop ([`../0025-quote-to-payment/plan.md`](../0025-quote-to-payment/plan.md)) — quotes/contracts attach to campaigns.
- 5.3 (Lookup admin) is reachable inline from 5.2's booking modal; the two are tempting to merge, but the lookup admin has its own surface (callable from anywhere) so keep it separate.
- 5.5 (Email) shipped on Resend ahead of the Q→C→I→P loop; the same `src/lib/email/send.ts` helper will carry quote/invoice sends.
- 5.6 + 5.7 are self-contained and can land in any order.
- 5.8 is the smallest leftover; fold into whichever chunk lands closest to it.
