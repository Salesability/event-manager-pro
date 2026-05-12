# Wiki log

Append-only chronological record of wiki maintenance: page creations, ingests of new state, edits driven by changes elsewhere, query-derived additions, and lint passes.

Entries are reverse-chronological (newest at the top). Format:

```
## YYYY-MM-DD — short headline

- bullet describing what changed and why
- link to the page(s) touched
```

---

## 2026-05-12 — `service_items` + `dealers.status`/`acquired_via` documented; quote-composer architecture section (0035 Phase 5)

- [data-model.md](data-model.md) — three updates: (1) tables-at-a-glance picks up the new dealers columns (`status` enum + `acquired_via`) and a new `service_items` row; (2) `dealers` section grows a "Lifecycle columns" subsection covering `status='prospect|active'` (prospect = quote drafted / no signed relationship; active = quote accepted or admin-flipped), `acquired_via` as free-form dealership-acquisition provenance, and the orthogonal-to-`archived_at` semantics + filter-pill math (resolved 0035 OQ #1) + `updateDealer` patch-style concurrency posture; (3) new `### service_items` subsection between MSA and lookup tables — `unit` enum discrimination, range-row null/non-finite bracket fail-closed posture (carry-forward from 0035 Phase 3 Codex pass-2), money-parse string-only `MONEY_RE`, RLS at `drizzle/0014_service_items_rls.sql`, 8-row seed catalog at `drizzle/0013_seed_service_items.sql`, and the noted Salesability-extension status (no STAR mapping).
- STAR vocabulary preamble (line 16) gains a `service_items` row. Audit-columns mixin paragraph + mixins reference table updated to include `service_items` in the lookup/catalog skip-`actors` group and the `archivable`-applies group.
- [architecture.md](architecture.md) — new "Quote composer — calculator, not a line-item picker" subsection under Patterns. Covers the three load-bearing pieces (pricing module at `src/lib/quotes/pricing.ts`, the `service_items` catalog, composer Server Actions in `src/features/quotes/actions.ts` — split into `setQuoteInputs` / `setQuoteTax` / `setQuoteDealer` with their distinct write surfaces), the structured-input shape (vs picker), the **planned** Send-time MSA gate (0035 Phase 4 + 0025 Phase 7.2 — `sendQuote` today is a guarded `draft → sent` stub with no MSA lookup), the two entry points (`/dealerships` row action — admin-only — + campaign-detail "Create Quote"), and the deferred inline-add-prospect affordance (Combobox primitive limitation).
- No code change — pure wiki ingest. Drove from the same-day Phase 1+2+3 ship of 0035 (commits `bfaeff7` / `dcc80bc` / `0a17124`); the underlying schema/code state was already true, the wiki is now caught up.
- The `quotes` table itself is **not** documented here — that's 0026 Phase 5's wiki obligation (its plan explicitly owns "Update `docs/wiki/data-model.md` with the new `quotes` table" in Phase 5), and will land when 0026 ships end-to-end.

## 2026-05-11 — Commercial spine locked: accepted Quote = contract; MSA per-Client; campaign demoted to operational delivery (0037 Phase 1)

- New wiki page [`docs/wiki/commercial-spine.md`](commercial-spine.md) — canonical reference for how a deal flows: Client → MSA → Quote → Event/Campaign → Invoice → Payment. Cites the Salesability MSA template clauses (§1.ii, §1.iii, §2.i, §2.ii, §2.iii, §3.i, §9) verbatim.
- **Why no `orders` table** — MSA §1.iii: *"Each Quote issued by Salesability and accepted by the Client shall constitute a separate distinct and independent agreement and contractual obligation of the Parties hereto."* The accepted Quote IS the binding agreement; an intermediate `Order` would be vestigial.
- **`master_service_agreements`** (built in 0037 Phase 2) — per-Client, 12-month term per §2.i. One row per signed MSA; renewals create new rows. Status enum (`pending | active | expired | terminated`). Carries `signedPdfStorageKey`, `dropboxSignDocumentId` (populated by 0025 Phase 7.2's send/sign flow), `templateVersion` (so future template revisions don't silently rebind existing signatories — OQ #6 working assumption).
- **Commercial column move** (built in 0026 Phase 2 + dropped from campaigns in 0037 Phase 4): `fee`, `travel`, `deposit_pct`, `tax_pct`, `quote_valid_days`, `audience_source_id` move off `campaigns` onto `quotes`. New `quotes.msa_id` FK joins each Quote to the MSA term it was accepted under.
- **FK direction flip:** instead of `quotes.campaign_id` (current 0026 sketch), the FK lives on the campaigns side as `campaigns.accepted_quote_id` (nullable; populated when an accepted Quote spawns a delivery campaign). Pre-0037 campaigns without a quote stay valid.
- **First-deal e-sig is a bundled envelope** (OQ #5 working assumption): one Dropbox Sign envelope with two documents (MSA + Quote PDF), each signed separately — so each archives at its own `signedPdfStorageKey`. NOT a merged PDF.
- **Sibling-plan reconciliation:** 0025 / 0026 / 0035 plan docs edited in place to reflect the spine. 0026 Phase 2 sketch picks up the new `quotes` columns + `msaId` + flipped FK; 0035 Phase 3 picks up the "Send action checks active MSA on Client" gate; 0025 picks up a "Shared foundation" bullet pointing at 0037 and the note that 7.2 (MSA send/sign) is a runtime prerequisite for first-time Quote acceptance.
- **Carry-forward (deferred chunks):** cancellation-fee math (50% × Quote within 21 days of Event start, OQ #4); daily MSA-expiry sweep job (OQ #3); buyer-province tax auto-compute (0026 OQ); MSA renewal UX beyond "Renew MSA" button (OQ #3 v1 manual flow).
- The `master_service_agreements` table + `quotes` table sections are NOT yet added to `data-model.md` — those tables don't exist yet. Will land in 0037 Phase 2 (MSA) and when 0026 Phase 2 ships (quotes). `data-model.md`'s `campaigns` section got a forward-looking note pointing to `commercial-spine.md`.

## 2026-05-11 — `sales_lead_sources` lookup renamed → `audience_sources` (0038)

- Lookup table `sales_lead_sources` → `audience_sources`; FK column `campaigns.sales_lead_source_id` → `campaigns.audience_source_id`; matching TS identifiers (`salesLeadSources`, `salesLeadSourceId`, `salesLeadSourceLabel`, `loadSalesLeadSources`, `createSalesLeadSource` / `updateSalesLeadSource` / `archiveSalesLeadSource`) all swept. Zero data migration (`ALTER TABLE … RENAME TO` preserves rows); 4 seeded labels and 13 campaign FK values intact.
- **Why:** the prior name carried three overloaded meanings — (a) audience source for a dealer's marketing campaign (the only meaning actually in use; seeded `Dealer Database / PBS / Third Party List / Previous Buyers`), (b) reserved-for-future per-`(campaign × contact)` target table per `data-model.md` OQ #6 (never built; if it lands, picks a fresh name), (c) dealership acquisition source (already split off onto `dealers.acquired_via` per the 2026-05-11 funnel review). Renaming before 0037 Phase 3 means `quotes.audience_source_id` lands cleanly under the right name.
- `data-model.md` updated: STAR vocab mapping (line 15), Audit-columns mixin note, ASCII diagram, campaigns row + lookup row in the table-by-table list, Lookup tables narrative, mixins table, and OQ #6 rewrite (future per-campaign target table picks a fresh name like `campaign_targets` / `sales_leads` — name TBD).
- Migration: `drizzle/0007_thin_thor.sql` (table + sequence + unique constraint + column + FK constraint + index, all renamed explicitly since Postgres doesn't cascade name updates from `ALTER TABLE … RENAME TO`). Hand-written via `--custom` because drizzle-kit's rename-vs-drop prompt needs TTY which the harness lacks. Snapshot `drizzle/meta/0007_snapshot.json` patched via `sed`. Journal `when` for 0007 bumped to come after 0006 so the migrator wouldn't silently skip it. Shipped as commit `1b64d12`.
- **Carry-forward:** RLS policy names `sales_lead_sources_service_role_all` / `sales_lead_sources_staff_all` in `drizzle/0003_enable_rls.sql:188-198` still carry the old name — policies stay attached by OID so behavior is correct, but pg_dump-visible names are stale. Optional `ALTER POLICY … RENAME TO` for a future pass. Also out of scope: UX-label rename ("Data Source(s)" → "Audience Source(s)" on `/admin/lookups` heading + `/production` column header) if the new schema name should become canonical UI vocabulary.

## 2026-05-11 — closed `0004-port-migration` umbrella + `0010-calendar-share-full` abandoned

- Port-migration tracker shipped end-to-end. Phases 1–4 + sub-phases 5.1–5.6 had long since shipped; 5.7 (Booking summary & reports) shipped 2026-05-07 via the now-closed `0014-summary-reports/plan.md` but the umbrella's tracker still showed `Pending` — corrected to `Done` (`155df20`).
- **5.8 (Full-calendar share link, `0010-calendar-share-full/plan.md`) dropped without shipping** per user 2026-05-11: per-coach share (`/share/coach/[id]`, shipped in port-migration Phase 4) covers the real use case; the full-calendar variant was not worth the work. 0010 also moved to `closed/` with an abandoned-without-shipping header — body stays as a starting point if "shareable read-only link" comes back per `docs/strategy/roadmap.md` Phase 2.
- Both folders moved to `docs/designs/closed/`. Cross-refs swept in `docs/designs/0025-quote-to-payment/plan.md`, `docs/strategy/roadmap.md`, today's other log entry (above), and `docs/designs/CURRENT.md` (0004 parked bullet removed; History entry added). Inside the moved 0004 plan, `../0025-…` refs climbed to `../../0025-…` (0025 stayed at top level); `../closed/X` refs collapsed to `../X` (now sibling under `closed/`); `../0010-…` ref unchanged (0010 also moved). Link-walk verified clean.

## 2026-05-11 — funnel review: `docs/designs/future/` folder + 0016 deferred to v2

- Funnel review surfaced a folder-organization gap: `docs/designs/` had no place for "scaffolded but explicitly waiting on a trigger event" — `closed/` means done, `CURRENT.md` **Parked** means queued-for-soon. Added `docs/designs/future/` as the third bucket. Convention captured in `CLAUDE.md` `### Deferring a chunk` section, parallel to `### Closing a chunk`. Top-level `ls docs/designs/` now shows only in-flight work.
- Moved `0016-book-your-event-intake` → `future/0016-book-your-event-intake`. v1 funnel uses manual in-app intake (existing `+ Book Event` booking modal + 0035 Phase 2 inline-create dealer flow); web intake / Squarespace cutover waits until prospect volume justifies it. Cross-refs swept in `docs/designs/closed/0004-port-migration/open-questions.md` (0004 also closed 2026-05-11 — see entry above), `docs/strategy/vision.md`, `docs/wiki/security.md`, and `docs/designs/CURRENT.md` (new **Future:** field).
- Same review collapsed 0037 Open Question #7 (no upstream lead carries `salesLeadSourceId` forward — set at composer time) and added `dealers.acquiredVia` (nullable text) to 0035 Phase 2. Surfaced that the existing `sales_lead_sources` lookup was being overloaded between *audience source* (consumer list used in a dealer's campaign — e.g. PBS, Previous Buyers) and *acquisition source* (how the dealership found Salesability — e.g. referral, trade show). Split the second concept off onto `dealers.acquiredVia`; the lookup retains its original audience-source meaning.

## 2026-05-09 — auth.md + security.md: capabilities-only at gates (0036 shipped)

- **Durable convention now declared:** every page, layout, Route Handler, and Server Action uses the capability layer for its decision — `assertCan(cap)` imperative or `capabilityClient(cap)` middleware. The role↔capability matrix in `src/lib/auth/capabilities.ts` is the single source of truth; roles are user identity + matrix input, but no app-code call site checks them directly. [auth.md → Route gating](auth.md#route-gating-rbac) rewritten from "four layers including `requireRole(role | role[])`" to "three layers, capability-keyed at the action gate." [security.md § 3](security.md) similarly rewrote the Action layer description.
- **4 new capabilities:** `app:access` (admin || staff || coach || viewer — mirrors `STAFF_APP_ROLES`), `admin:access` (admin), `reports:view` (admin || coach), `availability:edit` (admin || coach). Capability count: 22 → 22 (4 added, 0 removed at the union level — but the `roleListClient` factory retired entirely).
- **Migrated 11 call sites:** `(app)/layout.tsx` (now wraps `app:access` predicate via `requireStaffAccess`), 4 admin pages → `assertCan('admin:access')`, `/reports/page.tsx` + `/reports/export/route.ts` → `assertCan('reports:view')`, 3 availability action factories → `capabilityClient('availability:edit')`. Block Date button wrapped in `<Can capability="availability:edit">` so 0034 pairing reports 18/18 (was 17/17 with `availability:edit` server-only-flagged before the `<Can>`).
- **Retired:** `roleListClient` factory deleted from `src/lib/actions/action-client.ts` (4-tier comment block collapsed to 3 tiers); `src/lib/auth/require-role.ts` + its test deleted (0 production call sites after the page migrations); ESLint action-gate rule's allow-list narrowed from `['assertCan', 'requireRole', 'requireStaffAccess']` to `['assertCan', 'requireStaffAccess']`.
- **Layout decision refined.** Plan body said "swap `requireStaffAccess()` for `assertCan('app:access')` in layout.tsx"; refactored differently — `requireStaffAccess` retained for the friendly auth-error redirects (Portal-not-yet-available / Account-not-provisioned) because bare `assertCan('app:access')` redirects to `/`, which is inside `(app)/` and would loop on a dealer-only contact typing `/calendar` directly. The predicate is canonical (`can(profile, 'app:access')`); only the redirect-target wrapper is layout-specific.
- **`STAFF_APP_ROLES` extracted** to a client-safe constants module at `src/lib/auth/team-roles.ts` so both `requireStaffAccess` (server-only) and `capabilities.ts` (used by `<Can>` / `useCan` on the client) call the same `isStaffAppRole` predicate without crossing the `'server-only'` boundary. `load-team-membership.ts` re-exports for backward compat.
- 480/481 vitest (was 488/489 in Phase 3; net −8 because `require-role.test.ts` deleted). tsc + lint clean (4 pre-existing warnings). All four structural-enforcement layers green: 0031 lint clean, 0032 matrix test green (drift detection now scans `assertCan` + `capabilityClient`), 0034 pairing 18/18, 0033 middleware enforces auth-required-by-default.

## 2026-05-08 — architecture.md: PDF library + blob storage decisions (0026-quote-pdf Phase 1)

- New rows in the [architecture.md](architecture.md) stack table: **PDF generation = `pdf-lib`** (replaces `@react-pdf/renderer` from the original "Future integrations" placeholder) and **Blob storage = Google Cloud Storage** (picked over Supabase Storage). Both decisions land Phase 1 of [0026-quote-pdf](../designs/0026-quote-pdf/plan.md) and propagate forward to 7.2 (Contract MSA send + signed-PDF storage) and 7.3 (Invoice PDF).
- **PDF strategy: code-built layout, not template-fill.** Mid-Phase-1 the working assumption was that designers would upload a branded PDF template to GCS and `pdf-lib` would fill AcroForm fields / coordinate-overlay the data; user reversed it 2026-05-08 — code is now the source of truth for the document look (logo, fonts, margins, T&C wording). GCS holds rendered output only at `quotes/{id}/{rev}.pdf`. Layout iteration is dev-side via `src/lib/pdf/render-*.ts` modules. Pinning policy: a sent quote's PDF stays as-rendered; renderer-code changes do not retroactively alter previously-sent documents.
- New adapters: `src/lib/storage/gcs.ts` (`putObject` / `getObject` / `signedUrl`, env-pull-on-call mirroring `src/lib/email/send.ts` shape) and `src/lib/pdf/render-quote.ts` (single-page Quote with `public/saledayevents-logo.jpg` embedded top-right, header, Client + Event blocks, line-items table, totals, T&C + Invoicing & Payment language).
- New deps: `pdf-lib@1.17.1`, `@google-cloud/storage@7.19.0`, `server-only@0.0.1`. The `server-only` add is so the existing `import 'server-only'` guard in adapters continues to work in vitest mocks (vitest mocks the import; outside Next's bundler the package throws on evaluation, which is the intended behavior — adapters never import in client bundles).
- New env vars in `.env.example`: `GCS_PROJECT_ID`, `GCS_BUCKET`, `GCS_CREDENTIALS_JSON` (optional inline JSON; fall through to Application Default Credentials / workload identity in Cloud Run).
- 453/453 vitest (was 450; +3 render-quote tests covering PDF magic header + single US-Letter page round-trip + zero-line-item resilience). Opt-in visual smoke at `WRITE_SMOKE_PDF=1 pnpm vitest run src/lib/pdf` writes `/tmp/quote-smoke.pdf` for layout eyeball.
- Carry-forward into Phase 3: real-bucket `putObject`/`getObject` smoke once creds wired + multi-page handling if line-item count grows past one page + signature/dealer-detail block polish.

## 2026-05-08 — auth.md: next-safe-action middleware client (0033 shipped — auth-required is now the default)

- New `src/lib/actions/action-client.ts` exports four tiers: `baseClient` (no auth — auth-flow opt-out), `authedClient` (signed-in required), `capabilityClient(cap)` (auth + `assertCan(cap)`), `roleListClient(roles)` (auth + `requireRole(roles)` for the multi-role admit-set legacy carve-outs). All four built on `next-safe-action@8` + `zod@4`; navigation errors propagate via `isNavigationError`. Result shape now `{data?, serverError?, validationErrors?}` — the temporary `toLegacyResult` adapter at `src/lib/actions/legacy-result.ts` maps it back to `{ok|error}` so existing form callers don't need a flag-day rewrite.
- Migrated 22 Server Actions across `people/`, `schedule/`, and `email/` from line-1 imperative `await assertCan(...)` to `capabilityClient('cap').schema(formDataSchema).action(...)` (or `roleListClient(['admin','coach'])` for availability blocks). Every form caller — `dealer-form`, `dealers-admin`, `people-admin`, `orphan-auth-users`, `event-detail`, `booking-form`, `availability-admin`, `lookup-admin` — wrapped its action invocation with `toLegacyResult(...)`. Production `/production/export` Route Handler stays on imperative `assertCan` per Open Question 6 (no FormData / Response shape mismatch with the safe-action client).
- Tests: `people/actions.test.ts` and `email/actions.test.ts` mock `getUser` + `loadCurrentMembership` + `server-only` + Next-redirect-shaped `next/navigation`; tests use a small `call()` helper to unwrap the safe-action result back to the legacy shape so 70+ existing assertions don't all need rewriting. Matrix test (`action-gate-matrix.test.ts`) updated to use the same Next-shaped redirect mock so 0033 actions surface denials as throws (the safe-action client recognises `digest: 'NEXT_REDIRECT;...'` and re-throws).
- Capability pairing script (0034, `scripts/check-capability-pairing.mjs`) extended with a `capabilityClient('X')` regex so the CI check still finds server-side gates after the migration. 14/14 capabilities paired or opted out.
- Phase 4 (retire hand-rolled validators, write per-action Zod schemas) **deferred** — substantial separate work; revisit when 0016 booking-intake lands. Until then, actions use `formDataSchema = z.instanceof(FormData)` as a passthrough; bodies keep existing `field()` / `parseId()` / `parseLookupLabel()` calls.
- Updated [auth.md](auth.md) § "Capability gating: actions + UI affordances" with the middleware-chain pattern + `roleListClient`/`baseClient` carve-outs; § "Structural enforcement of the matrix" updated to note the lint rule scope shifts to legacy export shapes since safe-action's middleware enforces gate-presence by construction.
- 450/450 vitest, `pnpm tsc --noEmit && pnpm lint && pnpm check:capability-pairing` all clean.

## 2026-05-08 — auth.md: capability pairing CI check (0034 shipped — UI/server asymmetry now CI-enforced)

- New script `scripts/check-capability-pairing.mjs` (Node ESM, no extra deps) and `pnpm check:capability-pairing`. Extracts capabilities from UI (`<Can capability="X">` + `useCan('X')`) and server (`assertCan('X')` + `can(profile, 'X')`) sides; diffs; exits non-zero on either side missing the other. Closes the third class of authz mistake: 0031 catches "no gate," 0032 catches "wrong admit set," 0034 catches "gate on one side but not the other."
- Three UI affordances had been shipping with admin-only server gates but no `<Can>` wrapper (the page-level `requireRole('admin')` was carrying the load): `+ Add Person` (`/admin/people`), `+ Add Dealer` (`/dealerships`), `Adopt` (orphan-auth panel). All three wrapped in the matching `<Can capability=...>`. Two legitimately-server-only capabilities documented via the per-line `// expected: server-only` opt-out: `production:export` (Route Handler, CSV download with no UI button) and `coach-availability:edit-own` (row-relative server check; UI gates Block Date at role level, not capability level — coaches can press the button; the server enforces row ownership).
- Sabotage smokes: temporarily bogus-renamed `<Can capability="person:create">` to `person:bogus` → script reported both directions of asymmetry (UI-only `person:bogus` and server-only `person:create`). Restored.
- Updated [auth.md](auth.md) § "Structural enforcement of the matrix" — third sublayer (gate symmetry) now points at the script + the opt-out convention.
- 14/14 capabilities paired or opted out. 441/441 vitest still green (no behavior change for current admin role; the new `<Can>` wrappers are no-ops for the page's actual users). `pnpm tsc --noEmit && pnpm lint && pnpm check:capability-pairing && pnpm test --run` all clean.

## 2026-05-08 — auth.md: action-matrix executable test (0032 shipped — admit-set drift now CI-enforced)

- New test surface `src/features/__tests__/action-gate-matrix.ts` (24 rows — every gated Server Action + 2 protected Route Handlers) and `action-gate-matrix.test.ts` (24 × 7 = 168 outcome assertions + 1 drift-detection test = 169 tests). Drives each gated entry with mocked `getUser` + `loadCurrentMembership` + `redirect` + a Proxy-backed no-op `db` stub; asserts each of seven roles (unauth / admin / staff / coach / viewer / dealer / orphan) gets the documented outcome.
- Roles `staff`, `viewer`, `dealer` were added in-eval after Codex caught the partial-admit-set blind spot — a gate switched to `requireRole(['admin','staff'])` would silently pass a 4-role matrix. Sabotage smoke confirms: flipping `cancelCampaign` to `['admin','staff']` makes `staff → redirect:/` fail as expected.
- Drift detection: the suite re-walks `src/features/**/actions.ts` (top-level `'use server'`, with comment-tolerant directive detection) + any `*/actions/**/*.ts` shape + `src/app/**/route.ts`. Regex hits five export shapes (async function, const-async, default-async-function, default-async-arrow). Filters `// authz: public` opt-outs. New gated action without a matrix row → CI fails. Pairs with 0031: 0031 catches "no gate," 0032 catches "wrong admit set."
- Updated [auth.md](auth.md) § "Structural enforcement of the matrix" — three sublayers (presence / admit-set / symmetry) make the layering explicit; 0034 still pending for symmetry.
- 441/441 vitest (was 272 pre-0032; +169 new). `pnpm tsc --noEmit && pnpm lint` clean (only the 4 pre-existing warnings).

## 2026-05-08 — auth.md: action-gate ESLint rule (0031 shipped — gate-presence is now structurally enforced)

- New custom rule `action-gate/no-ungated-action` in `eslint-plugins/action-gate.mjs`. Rejects any exported `async` function in a `'use server'` file (or a `route.ts` Route Handler) that doesn't reach an allow-listed gate (`assertCan` / `requireRole` / `requireStaffAccess`) — directly or through a same-file wrapper helper that itself calls one. Per-function opt-out via `// authz: public` line comment.
- Wired in `eslint.config.mjs` against two file globs: `src/features/**/actions.ts` and `src/app/**/route.ts` (the latter with `routeHandler: true` to skip the `'use server'` directive precondition). Allow-list is forward-compatible with 0033 — the next-safe-action middleware shape will plug in via `gateNames` option.
- Four legitimate ungated exceptions opted out: `signInWithMagicLink`, `signInWithGoogle`, `signOut` (login flow itself) and the `/auth/callback` GET handler (OAuth code-for-session exchange runs before any session exists). All other Server Actions in `src/features/{people,schedule,email}/actions.ts` and the two protected Route Handlers (`/production/export`, `/reports/export`) pass cleanly — the 22 gated exports each reach an allow-listed gate.
- Updated [auth.md](auth.md) § Capability matrix with the new "Structural enforcement of the matrix" subsection: lint catches gate-missing (0031), test catches wrong-admit-set (0032), CI catches Can/assertCan-asymmetric (0034).
- 16/16 rule tests + full vitest suite green; `pnpm lint` clean (only the 4 pre-existing warnings).

## 2026-05-08 — auth.md: tightened coach surface (back-office actions all admin-only)

- After 0029 shipped the user noticed five Server Actions still admitted coach via `requireRole(['admin','staff','coach'])` — `createDealer`, `updateDealer`, `createCampaign`, `updateCampaign`, the email-send helper. Per the role purpose ("coach is field-only, admin runs the back office"), tightened all five to admin-only. `cancelCampaign` was already admin via `requireRole('admin')`; migrated it to `assertCan('campaign:cancel')` for matrix consistency.
- Added 4 capabilities to [capabilities.ts](../../src/lib/auth/capabilities.ts): `campaign:create`, `campaign:edit`, `campaign:cancel`, `email:send`. Reused the existing `dealer:create` / `dealer:edit` (defined in 0029 Phase 1, unused until now). 17 capabilities in v1.
- UI affordances tightened: `+ Book Event` on calendar wrapped in `<Can capability="campaign:create">`; event-detail's Email Client / Email Coach (single shared `<Can capability="email:send">`), Cancel Campaign (`<Can capability="campaign:cancel">`), Edit (`<Can capability="campaign:edit">`) all gated. Result for a coach loading the calendar: only Block Date is visible in the toolbar; clicking a campaign ribbon shows the read-only event detail with no action buttons.
- Updated [auth.md](auth.md) per-action gate matrix to reflect the migrations + the role-purpose paragraph for "coach" to make the surface explicit (Calendar + Reports + own availability blocks; nothing that schedules or shapes the booth).
- 239/239 vitest (was 227); test mocks updated for `email/actions.test.ts` (`requireRole` → `assertCan`).

## 2026-05-08 — auth.md + security.md: capability layer as the fourth gate (0029 shipped)

- Updated [auth.md](auth.md) `## Route gating (RBAC)`:
  - Bumped intro from "Three layers" to "Four layers"; added layer 4 capability gating with the **intent layer, not security layer** caveat.
  - Rewrote the per-action gate matrix to reflect 0029 Phase 2's migrations: 4 person CRUD actions → `assertCan('person:*')`, `archiveDealer` → `assertCan('dealer:archive')`, 6 lookup admin actions → `assertCan('lookup:edit')`, `production/export` Route Handler → `assertCan('production:export')`. Multi-role staff sends + cancelCampaign + auth flow stay on `requireRole`.
  - Added new `## Capability matrix` subsection — canonical role↔capability table (12 caps in v1: production / dealer / person / lookup × view/edit/create/archive/etc., plus `coach-availability:edit-own` and `:edit-any`).
- Updated [security.md](security.md) layer 3:
  - Renamed from "Action — require-role.ts" to "Action — require-role.ts + assert-can.ts" to reflect the capability PEP.
  - Inlined the **intent vs enforcement** distinction so a future reader doesn't mistake `<Can>` for a security boundary.
  - Updated the availability special-case to mention the `can()` delegation post-0029.
- Sourced from `closed/0029-capability-layer/` shipping 2026-05-08. Component test file was deferred — vitest is configured `environment: 'node'` and no `@testing-library/react` is installed; predicate test coverage lives in `src/lib/auth/capabilities.test.ts` (43 cases, table-driven) and `src/lib/auth/assert-can.test.ts` (7 cases, mock-driven).

## 2026-05-08 — auth.md: close the role-route-scoping gap paragraph (0028 shipped)

- Updated [auth.md](auth.md) `## What each role is for`:
  - Admin surface line now lists Calendar + Production List + Reports + Dealers + Admin-dropdown items (matches 0028-05-08-AM nav reshape).
  - Coach surface line corrected: was "**Calendar only**" (echoing the 0028 plan body's intent), now "**Calendar + Reports**" — Reports is gated `['admin', 'coach']` and remains the only non-admin staff page after 0028. Plan body's "Calendar only" claim was stronger than its scope; Reports left intentionally out of scope.
  - Replaced the stale gap paragraph (claimed Production + Dealers leak to coaches; queued tightening in `CURRENT.md` Parked) with a forward-looking matrix-enforcement paragraph naming the three layers + 0028 closure.
- Sourced from `closed/0028-role-route-scoping/` shipping 2026-05-08.

## 2026-05-07 — auth.md: capture role-purpose distinction (admin = ops, coach = field, dealer = customer-side)

- New `## What each role is for` section in [auth.md](auth.md), placed before `## Route gating (RBAC)` so the reader gets the *purpose* of each role before the *enforcement* layers. Captures: admin owns every staff page; coach's staff-app surface is **Calendar only** (the where-am-I-booked tool — coaches go to the dealership on the sales day); dealer is customer-side with no staff-app access today.
- Flagged the gap between intent and current state: `requireStaffAccess` admits any staff role to `(app)/*` and the nav only marks `admin: true` on Lookups + People. Production List + Dealers are visible to coaches today; tightening to admin-only is queued in `docs/designs/CURRENT.md` Parked (the role-scoping plan that surfaced after `/lists` → `/dealerships` rename).
- Sourced from a user clarification (2026-05-07): "production is an admin concern, the coach goes to the store on the sales day."

## 2026-05-07 — 0024 personform-radix-migration: Headless UI → Radix Primitives (Dialog, Checkbox, Combobox, Select)

- Five-phase chunk landed at `docs/designs/closed/0024-personform-radix-migration/`. Pilot surface was `src/features/people/people-admin.tsx`'s PersonForm dialog; the wrapper layer (`src/components/ui/`) absorbs both Headless UI (now removed) and Radix Primitives behind the same `Dialog.{Root, Backdrop, Panel, Title, Description, Close}` API so the six dialog consumers (`people-admin`, `orphan-auth-users`, `calendar-view`, `booking-form`, `lists/list-actions`, `production/row-actions`) didn't change.
- **Phase 1 — Dialog wrapper swap (commit `891d569`).** `@radix-ui/react-dialog` replaces `@headlessui/react`'s Dialog. Single `Dialog.Portal` inside `Root` so consumers keep rendering `Backdrop` + `Panel` as siblings; `Backdrop` becomes Radix's `Overlay`, `Panel` becomes `Content`. Tailwind selectors moved from HUI's `data-closed:*` to Radix's `data-[state=closed]:*`. **In-eval Codex High fix:** without `Dialog.Trigger`, Radix's focus-return-on-close had no target — Esc / outside-click / Close would have landed focus on `<body>`, losing keyboard users' place. Fixed with a `FocusContext` ref that captures `document.activeElement` on open + `Panel.onCloseAutoFocus` restores it.
- **Phase 2 — Roles fieldset → Radix Checkbox (commit `529be61`).** Three native `<input type="checkbox">` controls swapped for `<Checkbox.Root name="roles" value="admin|coach|dealer">` with a styled tick indicator. Wire format simplified: Radix Checkbox emits its own hidden `<input>` next to the visible button, so the explicit `name="roles"` hidden inputs that 0023 Phase 3 added became redundant — dropped them. Codex's 10-priority sweep returned all-confirmed-fine ("Bottom line: ship.").
- **Phase 3 — Dealers section → cmdk Combobox + Radix Select (commit `3f07ddc`).** New `src/components/ui/combobox.tsx` wraps `cmdk` (typeahead engine) inside `@radix-ui/react-popover` (positioning + portal). Public API `<Combobox options value onChange placeholder ariaLabel />`. The dealer-contact role's native `<select>` became inline Radix Select markup. **In-eval Codex Medium fix:** `Command.Item value={o.label}` would have made keyboard Arrow+Enter ambiguous on duplicate dealer names; switched to `value={o.value}` (dealer ID) + `keywords={[o.label]}` for filter matching, so cmdk identity is unique while search still matches by label. Largest UX win in the chunk: typeable dealer picker for the 50+ dealer list.
- **Phase 4 — Radix Form (deferred).** Decision tree resolved to "preserve the recently-shipped React 19 `useActionState` direction (commit `4a4afbd`); revisit when a second form needs the same treatment." When the `0016` booking-intake form lands, both forms can migrate to Radix Form in one pass.
- **Phase 5 — `@headlessui/react` rip-out + smoke (commit `cb5da66`).** `pnpm remove @headlessui/react` succeeded; `grep -rn "@headlessui" src/` returns empty. Both dialog call sites (`/admin/people` Add Person + `/calendar` Block Date) smoke-confirmed post-removal.
- 149/149 vitest, tsc + lint clean throughout. Three in-eval Codex catches landed across the chunk (1 High, 1 Medium, 0 outright fails).
- Carry-forward: Radix Form adoption alongside the booking-intake form; bundle-size baseline measurement (deferred — needs a build-comparison harness); a Playwright-style test that drives ref-less popover triggers (the browse tool's `getByRole` can't disambiguate ref-less elements, so Combobox/Select interactive flows are code-traced + Codex-source-traced rather than browser-clicked).

---

## 2026-05-06 — 0023 people-dealer-role: new `dealer` team-member role + "every contact has a role" invariant

- Six-phase plan landed at `docs/designs/closed/0023-people-dealer-role/`. Phases shipped in order 1, 3, 2, 4, 5, 6 — UI before backfill so a stale-form save couldn't archive freshly-backfilled rows (Codex Medium #2 from Phase 1's eval).
- **Phase 1 — enum + parser whitelist (`drizzle/0005_team_member_role_add_dealer.sql` + `0006_is_staff_member_excludes_dealer.sql`).** Added `'dealer'` to `team_member_role` pgEnum. Codex caught a real authz hole during eval: widening the enum without filtering it out of `is_staff_member()` would have aliased dealer-side staff as us-side staff (passing `requireStaffAccess()` + `auth/callback` routing → `/calendar`; passing `is_staff_member()` → all rows on every RLS-protected table). Closed in-eval by introducing `STAFF_APP_ROLES = ['admin','staff','coach','viewer']` constant + `isStaffAppRole()` predicate, mirrored in a new SQL migration that rewrites `is_staff_member()` with the same whitelist. New regression-guard test (`/auth/callback` for `roles=['dealer']` → `Portal+not+yet+available`). Commit `d2a1344`.
- **Phase 3 — PersonForm UI (Dealer checkbox + section gate + ≥1-role guard).** Discovered + fixed a precondition regression: the React 19 form-migration commit `4a4afbd refactor(forms)` had silently dropped the imperative `fd.append('roles', 'admin'|'coach')` calls without adding hidden `<input name="roles">` elements. PersonForm had been submitting `roles=[]` on every save for several hours. Phase 3 restored the wire format declaratively (hidden inputs per ticked role) AND added the Dealer checkbox + Dealers-section gate + Pick-at-least-one-role inline error. Action-side `ROLES_REQUIRING_APP_ACCESS = {admin, coach}` set introduced so `dealer` role survives the `appAccess`-off coercion. Commit `cdf554b`.
- **Phase 2 — backfill (`scripts/backfill-dealer-role.ts`).** Idempotent `--apply` script. Dry-run on dev showed 23 candidates (one per dealership staff contact) and zero truly-orphan contacts. Live-applied: 23 rows inserted. Re-run dry-run reports 0 candidates (idempotency confirmed). Commit `c8c586e`.
- **Phase 4 — auto-assign on `createDealer` / `updateDealer`.** Both branches insert `team_member_roles(role='dealer')` for the new staff link; `updateDealer`'s existing-link branch uses `.onConflictDoUpdate({ target, set: { archivedAt: null, updatedById: userId } })` to un-archive the role if it was previously archived (closes the re-grant-after-archive case Codex caught). Commit `ea3f522`.
- **Phase 5 — app-level invariant for "every contact has a role."** Single-line `if (roles.length === 0) return { error: 'At least one role is required.' };` assertions in `createPerson` (after `parseRolesField`) and `updatePerson` (after the appAccess coercion). DB trigger was the plan's working lean; app-level chosen instead because it's simpler to roll out, easier to teardown in test fixtures, and keeps `archivePerson` and `adoptOrphanAuthUser` carve-outs trivial. Wiki updated: `data-model.md` Overview documents the invariant + carve-outs; `auth.md` v1-wired-roles section now lists `admin/coach/dealer` and clarifies `STAFF_APP_ROLES`. Commit `3056603`.
- **Phase 6 — smoke verification.** Edit-mode for backfilled dealer-side contacts confirmed via snapshot — table row shows `Kevin Moore — dealer Fairley and Stephens · customer — active`, with the "dealer" cell mapping to the team_member_roles row and "Fairley and Stephens · customer" to the dealer_contacts link. Form-state default verified by code trace (same `useState(person?.roles.includes('dealer'))` pattern as admin/coach). Strict-mode collision prevented opening a specific row's Edit dialog directly through the browse tool.
- 149/149 vitest, tsc + lint clean across all six phases. Production data: re-run `scripts/backfill-dealer-role.ts --dry-run` against prod before this chunk reaches there — dev had zero truly-orphan contacts but prod is unknown.
- Carry-forward: dealer-role grants from `createDealer`/`updateDealer` aren't audited (Codex Medium from Phase 4 — wiring requires distinguishing granted/un-archived/no-op outcomes; warrants its own pass). The Phase 2 backfill's 23 inserts also aren't audited. Treating consistently means a follow-up audit-emit chunk for dealer paths.

---

## 2026-05-06 — 0019 security-architecture: five-layer defence in depth + audit_log + email hardening

- Eight-phase plan landed at `docs/designs/closed/0019-security-architecture/`. Five active phases shipped (1, 2, 3, 4, 7); two parked (5 boundary-discipline checks, 6 MFA enablement) for marginal-value reasons documented in the plan; Phase 8 wiki updates close the chunk.
- **Phase 1 — RLS baseline (`drizzle/0003_enable_rls.sql`).** Row Level Security enabled on every public domain table (11 tables, 22 policies). Each table gets `<table>_service_role_all` (FOR ALL TO `service_role` USING true) and `<table>_staff_all` (FOR ALL TO `authenticated` USING `public.is_staff_member()`). Helper function `is_staff_member()` is `STABLE, SECURITY DEFINER, search_path=''`. Drizzle's `postgres` connection role has `BYPASSRLS=t` (verified at write time), so the policies are inert on the staff app's data path — they light up the day the dealer portal queries via `supabase-js` + JWT. Integration test at `tests/integration/rls.test.ts` (4 cases) proves enforcement against a forged JWT. Commit `ae3dbe3`.
- **Phase 2 — `requireRole` per-action audit.** New `src/lib/auth/require-role.ts` generalises `requireAdmin` to a `role | role[]` parameter (8 vitest cases). 19 Server Actions audited across `schedule/`, `email/`, `people/` and the two admin pages: lookup admin → `requireRole('admin')`; mutating dealer/campaign → `['admin','staff','coach']`; availability → `['admin','coach']`; email sends → `['admin','staff','coach']`; `signOut`/sign-in flows ungated (they are the auth flow). The orphan `requireUserId()` private helper retired; `requireAdmin` async wrapper retired (only the pure `isAdmin(user)` predicate remains). Codex flagged that four "loose" actions (`createDealer`/`updateDealer`/`createCampaign`/`updateCampaign`) bypass the layout gate via direct POST — fixed in-eval to `requireRole(['admin','staff','coach'])`. Commit `04ad552`.
- **Phase 3 — coach availability ownership check.** New `src/features/schedule/availability-authz.ts:ensureAvailabilityOwnership(user, ...facets)`. Admin bypasses; non-admin coach can only mutate `kind='coach_unavailable'` rows where `coach_id` matches their own `coachContactId`. For updates, both the existing row's facet AND the desired-input facet must pass — prevents transferring ownership of own block by changing `input.coachId`. Codex flagged a TOCTOU window between the ownership read and the UPDATE; fixed in-eval by pinning `kind='coach_unavailable' AND coach_id = myCoachId` to the non-admin UPDATE/archive WHERE clauses. 9 vitest cases. Commit `278c429`.
- **Phase 4 — `audit_log` + `recordAudit()`.** New table `public.audit_log` (`id`, `occurred_at`, `actor_user_id` FK auth.users, `actor_role`, `action` enum, `target_table`, `target_id` nullable, `payload` jsonb) with 3 indexes + RLS (service_role permit-all, authenticated read-own-actions). Helper at `src/features/audit/actions.ts` is best-effort (try/catch + `console.error`) since the wired actions span DB+auth boundaries. Six emit points: `archivePerson`/`updatePerson` on→off → `user.deactivated`, `createPerson`/`updatePerson` (when roles changed) → `user.role_changed`, `archiveDealer` → `dealer.archived`, `cancelCampaign` → `campaign.cancelled`. `updatePerson` role-snapshot moved INSIDE the tx to close the race against concurrent updates. Commit `7a187cd`.
- **Phase 7 — email-send hardening (folded the parked Codex from 0011).** `siteUrl()` reads `process.env.SITE_URL` only — no Host-header fallback. `sendClient/CoachCampaignConfirmation` reject any campaign whose status isn't `booked`. `lib/email/send.ts` inverted the dev-redirect matrix: `APP_ENV=production` (case+whitespace-normalised) → real-send; non-prod with `EMAIL_DEV_TO` → redirect; non-prod without it → refuse. `EMAIL_FORCE_DEV_REDIRECT` flag retired. 18 new vitest cases across `send.test.ts` + `actions.test.ts`. The original 0011 rate-limit/replay High remains parked — needs a dedicated outbox/idempotency chunk before any public-facing surface (0016 intake) ships. Commit `e7c497a`.
- **Phase 8 (this ship).** Wiki updates: `auth.md` rewritten (RBAC reflects `requireRole`, new "Defence in depth" section + per-action gate matrix), `conventions.md` Drizzle/`supabase-js` section accurately describes the BYPASSRLS posture and the day-the-portal-ships invariant, new [`security.md`](security.md) is the five-layer map + threat-models + what-to-grep cheat-sheet, `index.md` linked. Manual security walk-through (three Server Actions × non-admin session → redirect; three tables × forged authenticated JWT → 0 rows) captured in the Phase 8 eval.
- 144/144 vitest, tsc + lint clean across all five active phases. Phase 5 + Phase 6 left parked.



- Five-phase plan landed at [`docs/designs/closed/0020-people-unification/`](../designs/closed/0020-people-unification/plan.md). Final eval `eval-2026-05-05-1600.md` PASS with warnings; two Codex Mediums fixed pre-commit each phase (Phase 2 TOCTOU on `updatePerson` + roles=[] coercion; Phase 3 lifecycle helper + partial-success contract; Phase 4 UUID validation + Postgres error mapping in `adoptOrphanAuthUser` + atomic per-orphan transaction in the bulk script).
- **One admin entry point.** `/admin/people` is now the only place to manage humans. The old `/admin/users` redirects there, the Sales Coaches section is gone from `/lists` (now Dealerships-only), and the legacy Server Actions (`createUser`, `linkUserToContact`, `setUserRoles`, `deactivateUser`, `createCoach`, `updateCoach`, `archiveCoach`) are deleted. The "Link contact" mental model is retired — auth.users is now a *facet* of a person, not a separate concept.
- **New code:** `src/features/people/{queries,actions,people-admin,orphan-auth-users}.{ts,tsx}` replaces the old `src/features/auth/{queries,users-admin,actions}.ts` + `src/app/(app)/lists/coach-form.tsx`. Single Server Action surface (`createPerson` / `updatePerson` / `archivePerson` + the rare `adoptOrphanAuthUser` exception path) handles every prior flow.
- **Status helper:** `lifecycle()` in `people-admin.tsx` derives `active` / `banned` / `inactive` from any-active-facet rather than just auth-ban state — fixes the contact-only archived-but-still-shows-active bug Codex caught.
- **Action contract:** `ActionResult` is now `{ ok: true, contactId, warning?: string } | { error: string }` so partial-success cases (DB committed, auth-side failed) close + refresh + show a warning toast instead of leaving the UI stale with a misleading error.
- **Orphan recovery:** `loadOrphanAuthUsers` lists auth users without a `contacts.user_id` link; an amber panel on the People page renders only when there are any. CLI fallback at `scripts/adopt-orphan-auth-users.ts` (dry-run by default; `--auto` adopts each in a per-user transaction with stub names).
- 100/100 vitest, tsc + lint clean. Auth wiki rewritten to match (`auth.md` provisioning section + Two-surfaces section). Lifecycle wiki updated to reference `/admin/people` + `people-admin.tsx`.
- Commits: `82e3564` (Phase 1) → `1053257` (Phase 2) → `33bfc51` (Phase 3) → `3dc6ec0` (Phase 4) → Phase 5 (this ship).

## 2026-05-05 — 0018 user-system: shipped + durable staff-app gate

- Plan moved to `docs/designs/closed/0018-user-system/`. Final eval `eval-2026-05-05-1341.md` PASS with warnings; both Codex Critical findings resolved across two follow-up commits (`b4e3b6a`, `9231bd8`).
- New helper [`src/lib/auth/require-staff-access.ts`](../../src/lib/auth/require-staff-access.ts) is the single source of truth for staff-app gating; called from `(app)/layout.tsx` and from `(app)/production/export/route.ts` (Route Handlers don't run through layouts, so the export was a CSV-exfil path the first round missed).
- Conditional UPDATE pattern (`WHERE id = ? AND user_id IS NULL AND archived_at IS NULL RETURNING id`) shipped on `linkUserToContact` and the `createUser` pick-existing path — replaces the prior check-then-write TOCTOU window.
- 81/81 vitest, tsc + lint clean.
- Two known follow-ups remain (Medium: `createUser` partial-success; Low: test-mock predicate-blindness). Captured in `CURRENT.md` Parked, not in flight.

## 2026-05-05 — 0018 user-system: full RBAC + role-aware login + auto-link trigger

- Phases 3-5 of [`docs/designs/closed/0018-user-system/plan.md`](../designs/closed/0018-user-system/plan.md) landed in working tree. End-to-end: an admin can provision a user *and* link them to a `contacts` row + `team_member_roles` rows in one Server Action call; a coach signing in lands on `/calendar` already pre-filtered to their own bookings; an unprovisioned auth user gets a clean error rather than a half-rendered staff app.
- **Auth wiki rewrite** ([auth.md](auth.md)) — provisioning section now describes the `/admin/users` flow (dashboard is fallback only); new "Route gating (RBAC)" section names the two-layer gate (middleware `ADMIN_PATHS` + page-level `requireAdmin()`) plus the hybrid `app_metadata.role` ↔ `team_member_roles` write-time consistency model; "Login routing" section spells out the three-branch decision tree from `src/app/auth/callback/route.ts`. Removed the `profiles` mention; `team_member_roles` is the staff-side role table.
- **Data-model** ([data-model.md](data-model.md)) — open Q #4 (signup trigger) resolved as shipped. Open Q #15 (role-junction integrity) resolved app-enforced for the `team_member_roles ↔ user_id` half. Inline reference at line 29 fixed to point at Q #15.
- **Trigger details:** `drizzle/0002_contact_user_backfill_trigger.sql` — `AFTER INSERT ON auth.users` (had to flip from BEFORE — FK from `contacts.user_id → auth.users.id` requires the parent row to exist before the trigger updates `contacts`), `SECURITY DEFINER` with locked `search_path`, idempotent. Smoke against dev DB on 2026-05-05 confirmed auto-link fires correctly.
- **0017-user-admin** moved to `closed/` as superseded — Phase 1 of 0018 covered its scope.

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
- Commits: `e729d9e → 1feb1a3 → 1c8bb09 → 9647939 → 04225b5 → 3f5b655 → c62bd52`. Full chunk plan at [`docs/designs/closed/0008-campaign-crud/plan.md`](../designs/closed/0008-campaign-crud/plan.md). RBAC findings (any-staff mutation by id) and the calendar slot-pack clamp deferred to dedicated chunks.

## 2026-04-30 — Phase 5.1 shipped: Lists CRUD (dealers + coaches)

- `/lists` is now CRUD-complete. Server actions in `src/features/schedule/actions.ts`: `createDealer`, `updateDealer`, `archiveDealer`, `createCoach`, `updateCoach`, `archiveCoach`. Each returns `{ ok: true } | { error: string }`; client forms use `useActionState` + Sonner toasts; archives use a native `confirm()` prompt + `useTransition`.
- Forms live in `src/app/(app)/lists/{dealer-form,coach-form,list-actions}.tsx`. Pure validators in `src/features/schedule/validators.ts` are unit-tested (see `validators.test.ts`).
- `loadDealers()` / `loadDealer()` were extended to surface a primary contact; the read path accepts any active `dealer_contact` and prefers `staff > customer > prospect` so already-imported dealers (whose link is `role='customer'` from the importer) keep their contact info on the Lists view. New writes use `role='staff'`. `updateDealer` also reads via the same priority order to avoid duplicating contacts on legacy rows.
- `swapPrimaryIdentifier()` enforces the partial unique on `(contact_id, kind) WHERE is_primary` by archive-then-insert inside one tx; it also pre-checks the *global* `(kind, value) WHERE archived_at IS NULL` partial unique and turns conflicts into a friendly toast (`{ error: 'That email address is already linked to another contact.' }`) — same email/phone can only be active on one `contacts` row.
- Soft-delete (`archived_at = now()`) only — no FK fanout breakage; existing campaigns keep referencing archived dealers/coaches by name on history rows.
- Schema implication for the future: a single human who is both a coach and a dealer-staff contact must be modelled as **one** `contacts` row with two roles. Today's UI always inserts a fresh `contacts` row, so cross-role linking is a manual SQL job until a contact-picker lands.
- Commits: `60e80f8 → 942ba69 → 2bd779e → 1b6358e → 5fbf9f4 → 1c2b4bf`. Full chunk plan at [`docs/designs/closed/0007-lists-crud/plan.md`](../designs/closed/0007-lists-crud/plan.md). UI polish + the rest of the visual smoke checklist were deferred.

## 2026-04-30 — UI primitives picked: Sonner + Headless UI (after backing out of Base UI)

- Tried `@base-ui/react` for Toast + Dialog as the single primitives layer; hit [mui/base-ui#4234](https://github.com/mui/base-ui/issues/4234) — `useToastManager()` re-subscribes to `toasts` on every mutation, so any consumer that puts the manager in a `useEffect`/`useMemo` dep array infinite-loops. Workarounds exist but the API ergonomics were already friction-heavy.
- Replaced with [Sonner](https://sonner.emilkowal.ski/) (toast: single `<Toaster/>`, simple `toast.success(...)` dispatcher) + [Headless UI](https://headlessui.com) (Dialog, future Listbox/Combobox). Tooltip is deferred until calendar ribbons need it.
- New file: `src/components/ui/toaster.tsx` (Sonner wrapper, themed cream/navy classNames) and `src/components/ui/dialog.tsx` (Headless UI wrappers exposed under a `Dialog.*` namespace). Mounted `<Toaster/>` once in `(app)/layout.tsx`.
- Updated [architecture.md](architecture.md) Stack table; full rationale in [docs/designs/closed/0007-lists-crud/plan.md](../designs/closed/0007-lists-crud/plan.md) Decisions.

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
- Plan + checklist: `docs/designs/closed/0006-port-views/plan.md`. Parent migration tracker in `docs/designs/0004-port-migration/plan.md` advanced 43% → 57% (Phase 4 of 7).

## 2026-04-30 — Legacy Sheets imported into Supabase

- Schema migration applied to Supabase via the Supavisor session pooler (`aws-1-us-west-2.pooler.supabase.com:5432`); free-tier direct connection is IPv6-only and unreachable from the dev network. `db-conventions` skill's "direct port-5432" advice is stale for free-tier projects.
- Lookup seed migration `drizzle/0001_seed_lookups.sql` shipped (`campaign_styles` × 1, `sales_lead_sources` × 4 — values lifted from the legacy data inventory).
- One-time import via `scripts/import-from-sheets.ts` (run with `pnpm dlx tsx`). Idempotent: re-run inserts zero. Three importers in FK order: Coaches → contacts/team_member_roles, Clients → dealers/contacts/dealer_contacts, Events → campaigns.
- Steady state in Supabase: 5 contacts, 5 `team_member_roles(coach)`, 26 dealers, 28 contacts (5 coaches + 23 client contacts; Shannon Tilley reused via her email), 24 dealer_contacts (2 dealers customer-less: Charlottetown Mitsubishi, Century Subaru), 33 contact_identifiers, 42 campaigns. FK integrity clean.
- Notable dedup outcomes: `abc motors` / `ABC Motors` collapsed to one dealer; Shannon Tilley's two legacy coach IDs collapsed to one contact, both legacy IDs map to the same person — 12 campaigns now ride on her single `contact_id`.
- See `docs/designs/closed/0005-sheets-import/{plan,notes}.md` for the full inventory, decisions, and execution notes.

## 2026-04-30 — Moved `wiki/` and `designs/` under `docs/`

- `wiki/` → `docs/wiki/`, `designs/` → `docs/designs/`. Folder roles unchanged; just consolidated under a single `docs/` parent. `git mv` preserved history.
- Updated `CLAUDE.md`, `README.md`, the `plan` skill (`SKILL.md` + `references/plan-template.md`), and internal cross-references in this wiki and existing design docs.
- Older log entries below still cite the pre-move paths (`wiki/...`, `designs/...`); left as historical record per the append-only rule.

## 2026-04-30 — `campaigns` channel cols: `boolean` → `integer` (preserve counts)

- Flipped `campaigns.sms_email`, `campaigns.letters`, `campaigns.bdc` from `boolean` (`NOT NULL DEFAULT false`) to nullable `integer`. The legacy Sheet stores per-channel record counts (e.g. `300`, `500`, `1200`); the bool form was throwing that data away on import.
- Why now: the schema migration hadn't been applied to Supabase yet, so this is a free regen of `0000_*.sql` rather than a follow-up `ALTER TABLE`. Driven by the Phase 3 (Sheets → Postgres) inventory pass — see `docs/designs/closed/0005-sheets-import/notes.md`.
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
