# Wiki log

Append-only chronological record of wiki maintenance: page creations, ingests of new state, edits driven by changes elsewhere, query-derived additions, and lint passes.

Entries are reverse-chronological (newest at the top). Format:

```
## YYYY-MM-DD — short headline

- bullet describing what changed and why
- link to the page(s) touched
```

---

## 2026-05-05 — 0018 user-system: shipped + durable staff-app gate

- Plan moved to `docs/designs/shipped/0018-user-system/`. Final eval `eval-2026-05-05-1341.md` PASS with warnings; both Codex Critical findings resolved across two follow-up commits (`b4e3b6a`, `9231bd8`).
- New helper [`src/lib/auth/require-staff-access.ts`](../../src/lib/auth/require-staff-access.ts) is the single source of truth for staff-app gating; called from `(app)/layout.tsx` and from `(app)/production/export/route.ts` (Route Handlers don't run through layouts, so the export was a CSV-exfil path the first round missed).
- Conditional UPDATE pattern (`WHERE id = ? AND user_id IS NULL AND archived_at IS NULL RETURNING id`) shipped on `linkUserToContact` and the `createUser` pick-existing path — replaces the prior check-then-write TOCTOU window.
- 81/81 vitest, tsc + lint clean.
- Two known follow-ups remain (Medium: `createUser` partial-success; Low: test-mock predicate-blindness). Captured in `CURRENT.md` Parked, not in flight.

## 2026-05-05 — 0018 user-system: full RBAC + role-aware login + auto-link trigger

- Phases 3-5 of [`docs/designs/shipped/0018-user-system/plan.md`](../designs/shipped/0018-user-system/plan.md) landed in working tree. End-to-end: an admin can provision a user *and* link them to a `contacts` row + `team_member_roles` rows in one Server Action call; a coach signing in lands on `/calendar` already pre-filtered to their own bookings; an unprovisioned auth user gets a clean error rather than a half-rendered staff app.
- **Auth wiki rewrite** ([auth.md](auth.md)) — provisioning section now describes the `/admin/users` flow (dashboard is fallback only); new "Route gating (RBAC)" section names the two-layer gate (middleware `ADMIN_PATHS` + page-level `requireAdmin()`) plus the hybrid `app_metadata.role` ↔ `team_member_roles` write-time consistency model; "Login routing" section spells out the three-branch decision tree from `src/app/auth/callback/route.ts`. Removed the `profiles` mention; `team_member_roles` is the staff-side role table.
- **Data-model** ([data-model.md](data-model.md)) — open Q #4 (signup trigger) resolved as shipped. Open Q #15 (role-junction integrity) resolved app-enforced for the `team_member_roles ↔ user_id` half. Inline reference at line 29 fixed to point at Q #15.
- **Trigger details:** `drizzle/0002_contact_user_backfill_trigger.sql` — `AFTER INSERT ON auth.users` (had to flip from BEFORE — FK from `contacts.user_id → auth.users.id` requires the parent row to exist before the trigger updates `contacts`), `SECURITY DEFINER` with locked `search_path`, idempotent. Smoke against dev DB on 2026-05-05 confirmed auto-link fires correctly.
- **0017-user-admin** moved to `shipped/` as superseded — Phase 1 of 0018 covered its scope.

## 2026-05-05 — New concept page: lifecycle.md (archive the relationship, not the entity)

- Surfaced by Codex Medium #2 in `docs/designs/0018-user-system/eval-2026-05-05-0945.md` — `deactivateUser` was archiving the linked `contacts` row, which silently broke `loadCoach()`, `/share/coach/[id]`, and "email assigned coach" workflows for already-assigned campaigns.
- Fix landed in `src/features/auth/actions.ts:deactivateUser` (working tree): it now archives only `team_member_roles`, not `contacts`. The auth user is still banned + `app_metadata.role` cleared.
- New wiki page [lifecycle.md](lifecycle.md) names the principle: master records (contacts, dealers, campaigns) are the historical anchor and rarely archived; relationships (`team_member_roles`, `dealer_contacts`, `contact_identifiers`) are what get archived. Documents the three query buckets — selection (active only), display (no filter), workflow-target (resolve regardless) — and lists the workflow-target reads (`loadCoach`, `/share/coach/[id]`) that still filter `archivedAt` and should be relaxed in a follow-up.

## 2026-05-01 — Phase 5.2 shipped: Campaign CRUD (booking modal + event detail)

- `/calendar` and `/production` now CRUD-complete for campaigns. Server actions `createCampaign`, `updateCampaign`, `cancelCampaign` in `src/features/schedule/actions.ts`; same `{ ok } | { error }` contract as 5.1. Cancel is a guarded transition (`status IN ('draft','booked')` only) — already-cancelled or completed rows return a friendly error.
- New client surfaces: `src/app/(app)/calendar/{booking-form,event-detail}.tsx` driven by `useActionState` + Sonner. Booking form auto-fills Contact / Phone / Email from the dealer's primary `dealer_contacts(role='staff')` row. End Date is a hidden auto-computed field (`startDate + duration`); server validates `endDate >= startDate` and rejects out-of-range volume fields (negative or above 32-bit signed-int ceiling).
- Calendar wiring: `+ Book Event` toolbar button, day-cell click pre-fills the form, ribbon click opens the read-only detail dialog (which then routes to Edit / Cancel). Production rows: View / Edit row buttons replace the disabled stubs from Phase 4; new "Show cancelled" filter (default off) — cancelled campaigns are also excluded from `/share/coach/[id]`. Mutations revalidate `/calendar`, `/production`, and `/share/coach/[id]`.
- Pricing fields (`fee`, `travel`, `tax_pct`, `deposit_pct`, `quote_*`) intentionally not surfaced — they belong to Phase 7's quote UI.
- Auth-gated browser smoke is now drivable via the new `inject-supabase` subcommand on `.claude/tools/browse` (admin `generateLink` → `verifyOtp` → `setSession` cookies). Phase 6 of the sub-plan was exercised end-to-end against the dev DB.
- Commits: `e729d9e → 1feb1a3 → 1c8bb09 → 9647939 → 04225b5 → 3f5b655 → c62bd52`. Full chunk plan at [`docs/designs/shipped/0008-campaign-crud/plan.md`](../designs/shipped/0008-campaign-crud/plan.md). RBAC findings (any-staff mutation by id) and the calendar slot-pack clamp deferred to dedicated chunks.

## 2026-04-30 — Phase 5.1 shipped: Lists CRUD (dealers + coaches)

- `/lists` is now CRUD-complete. Server actions in `src/features/schedule/actions.ts`: `createDealer`, `updateDealer`, `archiveDealer`, `createCoach`, `updateCoach`, `archiveCoach`. Each returns `{ ok: true } | { error: string }`; client forms use `useActionState` + Sonner toasts; archives use a native `confirm()` prompt + `useTransition`.
- Forms live in `src/app/(app)/lists/{dealer-form,coach-form,list-actions}.tsx`. Pure validators in `src/features/schedule/validators.ts` are unit-tested (see `validators.test.ts`).
- `loadDealers()` / `loadDealer()` were extended to surface a primary contact; the read path accepts any active `dealer_contact` and prefers `staff > customer > prospect` so already-imported dealers (whose link is `role='customer'` from the importer) keep their contact info on the Lists view. New writes use `role='staff'`. `updateDealer` also reads via the same priority order to avoid duplicating contacts on legacy rows.
- `swapPrimaryIdentifier()` enforces the partial unique on `(contact_id, kind) WHERE is_primary` by archive-then-insert inside one tx; it also pre-checks the *global* `(kind, value) WHERE archived_at IS NULL` partial unique and turns conflicts into a friendly toast (`{ error: 'That email address is already linked to another contact.' }`) — same email/phone can only be active on one `contacts` row.
- Soft-delete (`archived_at = now()`) only — no FK fanout breakage; existing campaigns keep referencing archived dealers/coaches by name on history rows.
- Schema implication for the future: a single human who is both a coach and a dealer-staff contact must be modelled as **one** `contacts` row with two roles. Today's UI always inserts a fresh `contacts` row, so cross-role linking is a manual SQL job until a contact-picker lands.
- Commits: `60e80f8 → 942ba69 → 2bd779e → 1b6358e → 5fbf9f4 → 1c2b4bf`. Full chunk plan at [`docs/designs/shipped/0007-lists-crud/plan.md`](../designs/shipped/0007-lists-crud/plan.md). UI polish + the rest of the visual smoke checklist were deferred.

## 2026-04-30 — UI primitives picked: Sonner + Headless UI (after backing out of Base UI)

- Tried `@base-ui/react` for Toast + Dialog as the single primitives layer; hit [mui/base-ui#4234](https://github.com/mui/base-ui/issues/4234) — `useToastManager()` re-subscribes to `toasts` on every mutation, so any consumer that puts the manager in a `useEffect`/`useMemo` dep array infinite-loops. Workarounds exist but the API ergonomics were already friction-heavy.
- Replaced with [Sonner](https://sonner.emilkowal.ski/) (toast: single `<Toaster/>`, simple `toast.success(...)` dispatcher) + [Headless UI](https://headlessui.com) (Dialog, future Listbox/Combobox). Tooltip is deferred until calendar ribbons need it.
- New file: `src/components/ui/toaster.tsx` (Sonner wrapper, themed cream/navy classNames) and `src/components/ui/dialog.tsx` (Headless UI wrappers exposed under a `Dialog.*` namespace). Mounted `<Toaster/>` once in `(app)/layout.tsx`.
- Updated [architecture.md](architecture.md) Stack table; full rationale in [docs/designs/shipped/0007-lists-crud/plan.md](../designs/shipped/0007-lists-crud/plan.md) Decisions.

## 2026-04-30 — Phase 4: ported the three views (Calendar / Production / Lists)

- New tabbed shell at `(app)/` with shared `AppHeader` + `AppNav`; redirects `/` → `/calendar`. Auth still gated by `proxy.ts` middleware.
- `/lists` — read-only two-column dealers + coaches view sourced from `loadDealers()` / `loadCoaches()` in `src/features/schedule/queries.ts` (coaches join `team_member_roles role='coach'` and merge primary email/phone from `contact_identifiers`).
- `/production` — campaigns table with debounced search + `?status=upcoming|past` filter. Filter inputs are a small client component that drives `router.replace(?...)`; the table renders server-side.
- `/calendar` — verbatim port of legacy `renderCalendar` / `drawRibbons`: per-row independent slot assignment (lowest available, `MAX_RIBBONS=10`, `RIBBON_H=22`, `RIBBON_GAP=3`, `TOP_PAD=26`), absolutely-positioned ribbon overlay sized via `getBoundingClientRect()` on layout effect + `resize`, coach filter pills, today/blocked/selected-range cell tints. Coach color palette unchanged.
- `/share/coach/[id]` — public read-only calendar filtered to one coach. Replaces the legacy `?coach=<id>` query-param convention with a path-based public route (cleaner than allowlisting `/calendar?coach=` in middleware). Added `/share/coach` to `PUBLIC_PATHS`.
- Theme: introduced navy/cream + DM Serif Display / DM Sans via Tailwind 4 `@theme`. Tokens: `navy/navy-light/navy-pale`, `accent/accent-light` (real warm gold, not the legacy gray-misnamed-`gold`), `cream`, `stone-100..800`, `status-red/green/blue`. Removed the dark-mode CSS so the app is cream-only.
- Cleanups: deleted `src/features/ping/` and the orphan `<SessionBanner/>` (was rendering twice once `(app)/layout.tsx` carried the chrome). `src/app/page.tsx` deleted; route group's `(app)/page.tsx` covers `/`.
- Verification: `pnpm tsc --noEmit` clean, `pnpm test` passes (5/5), dev-server smoke test confirms `/` redirects to `/login`, `/calendar`/`/production`/`/lists` 307 to `/login` when unauth'd, `/share/coach/1` 200 when public.
- Out of scope this phase: any mutations (Add/Edit/Delete on dealers/coaches/campaigns, booking modal, manage-styles modals, blocked-date editor, share-link emailer). All deferred to Phase 6 (quote → contract → invoice → payment) of the parent migration.
- Plan + checklist: `docs/designs/shipped/0006-port-views/plan.md`. Parent migration tracker in `docs/designs/0004-port-migration/plan.md` advanced 43% → 57% (Phase 4 of 7).

## 2026-04-30 — Legacy Sheets imported into Supabase

- Schema migration applied to Supabase via the Supavisor session pooler (`aws-1-us-west-2.pooler.supabase.com:5432`); free-tier direct connection is IPv6-only and unreachable from the dev network. `db-conventions` skill's "direct port-5432" advice is stale for free-tier projects.
- Lookup seed migration `drizzle/0001_seed_lookups.sql` shipped (`campaign_styles` × 1, `sales_lead_sources` × 4 — values lifted from the legacy data inventory).
- One-time import via `scripts/import-from-sheets.ts` (run with `pnpm dlx tsx`). Idempotent: re-run inserts zero. Three importers in FK order: Coaches → contacts/team_member_roles, Clients → dealers/contacts/dealer_contacts, Events → campaigns.
- Steady state in Supabase: 5 contacts, 5 `team_member_roles(coach)`, 26 dealers, 28 contacts (5 coaches + 23 client contacts; Shannon Tilley reused via her email), 24 dealer_contacts (2 dealers customer-less: Charlottetown Mitsubishi, Century Subaru), 33 contact_identifiers, 42 campaigns. FK integrity clean.
- Notable dedup outcomes: `abc motors` / `ABC Motors` collapsed to one dealer; Shannon Tilley's two legacy coach IDs collapsed to one contact, both legacy IDs map to the same person — 12 campaigns now ride on her single `contact_id`.
- See `docs/designs/shipped/0005-sheets-import/{plan,notes}.md` for the full inventory, decisions, and execution notes.

## 2026-04-30 — Moved `wiki/` and `designs/` under `docs/`

- `wiki/` → `docs/wiki/`, `designs/` → `docs/designs/`. Folder roles unchanged; just consolidated under a single `docs/` parent. `git mv` preserved history.
- Updated `CLAUDE.md`, `README.md`, the `plan` skill (`SKILL.md` + `references/plan-template.md`), and internal cross-references in this wiki and existing design docs.
- Older log entries below still cite the pre-move paths (`wiki/...`, `designs/...`); left as historical record per the append-only rule.

## 2026-04-30 — `campaigns` channel cols: `boolean` → `integer` (preserve counts)

- Flipped `campaigns.sms_email`, `campaigns.letters`, `campaigns.bdc` from `boolean` (`NOT NULL DEFAULT false`) to nullable `integer`. The legacy Sheet stores per-channel record counts (e.g. `300`, `500`, `1200`); the bool form was throwing that data away on import.
- Why now: the schema migration hadn't been applied to Supabase yet, so this is a free regen of `0000_*.sql` rather than a follow-up `ALTER TABLE`. Driven by the Phase 3 (Sheets → Postgres) inventory pass — see `docs/designs/shipped/0005-sheets-import/notes.md`.
- Resolved open Q #5 in [data-model.md](data-model.md) (kept inline as integers; deferred the `services` lookup + join-table option until reporting needs it).
- Regenerated `drizzle/0000_cute_ser_duncan.sql` (replaced `0000_ambiguous_mister_fear.sql`); auth-schema gotcha re-stripped per `db-conventions`. `pnpm tsc --noEmit` and `pnpm test` clean.

## 2026-04-30 — `blocked_dates` → `availability_blocks` (multi-source, per-coach, ranged)

- Replaced the single-purpose `blocked_dates` (PK=date, single `reason` text) with `availability_blocks` — one table covering three sources via a `kind` enum (`statutory_holiday | company_closure | coach_unavailable`), with optional `coach_id` for per-coach scoping and `start_date`/`end_date` for ranges.
- Why one table not three: the booking-time question is *one* question ("is date X bookable for coach Y?"). One filtered scan beats unioning across per-source tables; the shape is genuinely the same (date or range, optionally scoped to a coach).
- Schema highlights: `start_date`/`end_date` inclusive both ends with CHECK; `coach_id` nullable, FK contacts, `ON DELETE CASCADE`, expected `team_member_roles(role='coach')` (app-enforced); `region` nullable for jurisdiction-aware stat holidays (deferred until multi-province footprint); `source` nullable for provenance (e.g. `"date-holidays:CA"` vs manual). Now carries `actors` and `archivable` mixins (was admin-only).
- Out of scope and recorded as new open questions: recurring weekday rules (#17 — keep concrete dates only, add `availability_rules` later if needed), holiday-seed automation (#18 — annual job idempotent on `(kind, start_date, region)`), region handling (#19), partial-day grain (#20), conflict precedence in the UI (#21).
- Open Q #16 (schema-source rename) updated to mention `blocked-dates.ts` → `availability-blocks.ts` is part of the structural rewrite, not a pure rename.
- Updated [data-model.md](data-model.md): layout ERD, edges-left-out, table glance, relationships (added coach edge), mixins applied-to (added `availability_blocks`), new *Availability* section replacing the lookup-table blurb, open questions appended.
- Schema source not yet aligned (`src/lib/db/schema/blocked-dates.ts` still has the old PK=date shape). Falls into the same pending structural-migration pass as the rest of open Q #16.



- Reverted the `team_members` → `staff_members` rename from the very first STAR pass; "team" is the user's internal vocabulary and the structural payoff of matching STAR's *Staff Member* noun on a junction table is marginal. STAR alignment is preserved at the *concept* level (the `team_member_roles` table is still annotated as STAR *Staff Member*, BC 12).
- Net us-side naming: junction is `team_member_roles`; role enum values unchanged (`admin | staff | coach | viewer`). The "staff" value inside the us-side enum is now a within-enum semantic ("general non-specialist team member") rather than colliding with a table name.
- Updates: layout ERD, table glance, identity & people section, open questions, and prose throughout [data-model.md](data-model.md).

## 2026-04-30 — Staff folded into `contacts`; role-junction symmetry

- Eliminated the `staff_members` table. Us-side staff are now `contacts` rows with `staff_member_roles` assignments — the internal-team analogue of `dealer_contacts`.
- `staff_member_roles`: `contact_id` (FK) + `role` enum (`admin|staff|coach|viewer`) + `specialty` (sparse, used when `role='coach'`); UNIQUE `(contact_id, role)`. Multi-role internal staff get multiple rows, mirroring the `dealer_contacts` two-rows-per-role pattern.
- One master person table — `contacts` — now covers everyone (us-side + them-side). STAR-aligned with the *Party* root abstraction (BC 1's "Source of truth for all identities: Staff, Customer, Vendor, Organization, Dealer"). A coach hired from a dealership lives as one `contacts` row with both a `staff_member_roles(role='coach')` and a historical `dealer_contacts(role='staff')` — no identity duplication.
- Auth model shift: `staff_members.id = auth.users.id` (uuid PK alias) is gone. `auth.users.id` flows in as `contacts.user_id` (nullable UUID FK, UNIQUE, `ON DELETE SET NULL`). Deleting an auth user revokes access without erasing the person record (correct for contacts who may still be a dealer's customer).
- `campaigns.coach_id` now FKs `contacts.id` (bigint) with app-enforced `staff_member_roles(role='coach')` instead of FKing the old `staff_members.id` (uuid).
- Open Q #3 (multi-role staff) dissolved — multi-role is now structurally supported. Open Q #4 (role-name collision) reframed: both role enums carry a `staff` value but in unambiguous contexts; default stance is to accept.
- Updated [data-model.md](data-model.md) end-to-end: top callout, layout ERD, table glance, relationships, identity & people section (one master table, two parallel role-junctions), mixins (no more uuid-PK domain table), open questions renumbered.
- Schema source files in `src/lib/db/schema/` and `drizzle/` migrations not yet aligned — the unification has now compounded into a real structural rewrite (was: rename pass; now: structural migration).

## 2026-04-30 — Unified `contacts` model with role-tagged dealer junction

- Restructured them-side people: a single `contacts` table holds every person known to any dealer, with a role-tagged junction `dealer_contacts` carrying the per-dealer relationship.
- `dealer_contacts(role)` enum: `customer | staff | prospect`. UNIQUE on `(dealer_id, contact_id, role)` — two rows for a person who is both staff *and* a customer at the same dealer (chosen over array-roles or bitmask: integrity over schema parsimony, per the data-integrity-first principle).
- Per-role state on the junction: `do_not_contact`, `since`, `source`, `last_contacted_at`, `title` (sparse, only used when `role='staff'`).
- Renames (rolling back parts of the prior pass + new unification):
  - `sales_leads` → `contacts` (was `customers` → `sales_leads` in prior pass — rolled back; STAR's *Sales Lead* (BC 3) is a sales process artifact, not a master person record. The right BC 1 mapping is *Customer Profile* / *Party*, which `contacts` fills.)
  - `sales_lead_identifiers` → `contact_identifiers`
  - `dealer_sales_leads` → `dealer_contacts` (+ `role` enum, absorbs the old `contacts.dealer_id` link)
  - `vehicle_ownerships.sales_lead_id` → `vehicle_ownerships.contact_id`
  - The OLD `contacts` table (dealer staff with `dealer_id`) goes away — staff are now `contacts` rows linked via `dealer_contacts(role='staff')`.
- `sales_lead_sources` lookup name preserved — reserved against the future per-campaign target table (open Q #6), which is the right home for the STAR *Sales Lead* (BC 3) noun.
- Updated [data-model.md](data-model.md) end-to-end: top callout, layout ERD, contacts cluster diagram, table glance, relationships, identity & people section (now two tables, not three), open questions (renumbered, added #16 on `dealer_contacts` integrity rules).
- Schema source files in `src/lib/db/schema/` and `drizzle/` migrations not yet aligned — the unification is a structural change (not just a rename), so it'll need a fresh migration.

## 2026-04-30 — ID strategy: bigint + nanoid `public_id` hybrid

- Resolved the bigint-vs-UUID question (was open #17 in [data-model.md](data-model.md), now pruned).
- Decision: keep bigint identity as the internal PK default; add a `public_id text not null unique` column (nanoid 12-char URL-safe slug, generated in app code) on tables that surface in dealer-portal URLs — currently `dealers` and `campaigns`.
- Rationale: bigint preserves B-tree locality on hot tables (`sales_lead_identifiers`, `vehicle_ownerships` will hit millions of rows on bulk imports); `public_id` gives unguessable URLs without a Postgres-version dependency.
- Why not UUIDv7: PG 18+ native and Supabase is on PG 17.6. Polyfills exist ([`cem/uuidv7` TLE](https://database.dev/cem/uuidv7), [Fabio Lima's gist](https://gist.github.com/kjmph/5bd772b2c2df145aa645b837da7eca74)) but add a moving part for marginal gain over the hybrid. Revisit if/when Supabase ships PG 18.
- pg_uuidv7 status confirmed: still not on Supabase; both feature requests ([#22015](https://github.com/orgs/supabase/discussions/22015), [#22584](https://github.com/orgs/supabase/discussions/22584)) remained unanswered as of Jan 2026.
- Updated [data-model.md](data-model.md): expanded the *ID types* section with the hybrid pattern; added `public_id` to `dealers` and `campaigns` rows in the table glance.

## 2026-04-30 — STAR-vocabulary alignment in `data-model.md`

- Renamed core nouns to match the [STAR Standard](https://www.starstandard.org/) Domain Map:
  - `clients` → `dealers` (STAR *Dealer Profile*, BC 1)
  - `customers` → `sales_leads` (STAR *Sales Lead*, BC 3)
  - `customer_identifiers` → `sales_lead_identifiers` (STAR *Identifier*, BC 7)
  - `client_customers` → `dealer_sales_leads`; `customer_since` → `lead_since`
  - `events` → `campaigns` (STAR *Marketing Campaign*, BC 6)
  - `event_styles` → `campaign_styles`; `customer_list_sources` → `sales_lead_sources`
  - `team_members` → `staff_members` (STAR *Staff Member*, BC 12)
  - `contacts` kept (no clean STAR analogue for "dealer staff who is our portal user")
- Knock-on FK renames: `events.client_id` → `campaigns.dealer_id`, `contacts.client_id` → `contacts.dealer_id`, etc. (full list in [data-model.md](data-model.md)).
- Added a vocabulary callout near the top of [data-model.md](data-model.md) explaining the STAR mapping.
- Dropped the old "two-tier domain language (client vs customer)" callout — the new naming is unambiguous on its own.
- Surfaced two new open questions: (4) role-name collision (`staff_members` table with `staff` role), (16) schema-source rename pass — `src/lib/db/schema/`, `drizzle/` migrations, and importing code still use the old names and need a follow-up rename pass before more migrations land.
- No code or migrations changed; this pass is wiki-only.

## 2026-04-30 — Wiki bootstrap (full pass)

- Created `wiki/` (formerly `docs/` — renamed to align with the Karpathy LLM-wiki pattern).
- Added [index.md](index.md) (catalog) and `log.md` (this file).
- `CLAUDE.md` updated with the wiki schema (page types, ingest/query/lint workflow).
- Ingested four reference pages from current state:
  - [data-model.md](data-model.md) — from `src/lib/db/schema/` (auth/profiles/clients/contacts/coaches/events + lookups). Four open schema questions captured inline.
  - [architecture.md](architecture.md) — from `designs/0001-port-stack-analysis/notes.md` + scaffold plan + CLAUDE.md. Stack picks, folder layout, migration roadmap, compromised-secrets note.
  - [auth.md](auth.md) — from the 100%-done `designs/0003-supabase-auth/plan.md`. Sign-in flow, signups-disabled invariant, route gating, staff-vs-portal login routing. Four open auth threads captured.
  - [conventions.md](conventions.md) — from CLAUDE.md + `db-conventions` skill, rephrased for human readers. Mutations rule, schema defaults, mixins, migrations, rollbacks, backfills, git workflow.
