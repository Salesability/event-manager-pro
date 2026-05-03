# Book Your Event — public intake & marketing-site integration

**Started:** 2026-05-03

The "Book Your Event" CTA on [`salesability.ca/book-your-event`](https://www.salesability.ca/book-your-event) is the planned public entry point into this app (per project memory `project_entry_point.md`). Today the page hosts a Squarespace form: prospect submits → email goes to Shannon → manual follow-up → manual campaign creation. "Tight integration" means our app *owns* the booking-form surface so submissions land in our DB as first-class records, and Squarespace's role is reduced to a redirect.

**Done =** a prospect on `salesability.ca` clicks "Book Your Event", lands on a public page in this app, fills the form, hits submit; the submission persists as a `campaign_intakes` row, Shannon gets an email, the prospect sees a confirmation; staff can triage intakes from a gated `/admin/intakes` list and convert an accepted intake into a real `campaigns` row (matching/creating `dealers` + `contacts` as needed).

## Decisions needed (flush these before Phase 2)

These are real forks. Most should be raised with the user before the public form is locked in.

1. **Form fields.** The Squarespace form's actual fields aren't visible in the public HTML (web fetch couldn't introspect the widget). Need to either: (a) ask Shannon what fields the current form collects, or (b) propose a minimal set (dealership name, contact name, email, phone, requested-date range, notes) and confirm. The schema in Phase 1 needs this answer.
2. **Domain.** Where does the form live — `events.salesability.ca/book-your-event` (subdomain, current Cloud Run cutover plan) or `salesability.ca/book-your-event` (Squarespace replaced with a reverse-proxy / iframe)? Subdomain is far simpler — Squarespace just changes the button's `href`. Same-domain requires DNS/proxy work.
3. **Squarespace cutover mechanics.** Once our form is live, the Squarespace `/book-your-event` page either (a) redirects to ours, (b) gets deleted entirely, or (c) keeps running in parallel as a fallback for a grace period. Affects the Phase 5 messaging.
4. **Dealer/contact dedup on convert.** When staff converts an intake to a campaign, do we look up the dealer by name and reuse, prompt to choose between "match existing dealer X" vs "create new", or always create new? Affects the Phase 4 UX.
5. **Anti-bot.** Public unauthenticated form on a brand surface — needs at minimum a honeypot, ideally Turnstile or hCaptcha. Squarespace had basic spam filtering; our form is starting from zero.
6. **Branding.** This work depends on Q10 in `0004-port-migration/open-questions.md` (SaleDay vs Salesability mark) — prospects landing here from a Salesability marketing page should see Salesability branding. Either resolve Q10 before Phase 2 or accept the SaleDay mark for the launch.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `campaign_intakes` table + Drizzle migration | Pending | - |
| 2: Public `/book-your-event` page + `submitIntake` Server Action + `PUBLIC_PATHS` update | Pending | - |
| 3: Confirmation UX — thank-you screen + Resend email to Shannon | Pending | - |
| 4: Staff `/admin/intakes` list + "Convert to campaign" flow | Pending | - |
| 5: Marketing-site cutover — change Squarespace button `href` (or DNS proxy) | Pending | - |
| 6: Verification — eval-smoke + e2e manual smoke | Pending | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/campaign-intakes.ts` | `src/lib/db/schema/campaigns.ts:1` | Sibling schema, same audit-column conventions (`createdAt`, `archivedAt`, `publicId`); intake mostly mirrors campaign minus the bound dealer/coach FKs. |
| `drizzle/0002_campaign_intakes.sql` | `drizzle/0000_cute_ser_duncan.sql` | Generated migration — same shape (Drizzle-emitted CREATE TABLE + indexes). |
| `src/app/book-your-event/page.tsx` | `src/app/login/page.tsx:1` | Public unauth route, centered-card form, Server-Action submission. The login page is the closest existing example of an *unauthenticated* form on the marketing-style surface. |
| `src/features/intake/actions.ts` (`submitIntake`, `convertIntakeToCampaign`) | `src/features/schedule/actions.ts:389` (`createCampaign`) | Same shape: parse `FormData` via Zod-ish validator → insert → return `ActionResult`. `convertIntakeToCampaign` extends the pattern with a transaction that touches `dealers` + `contacts` + `campaigns` + `campaign_intakes`. |
| `src/app/(app)/admin/intakes/page.tsx` | `src/app/(app)/production/page.tsx:1` | Gated table-layout with filter + per-row actions; intake triage is the same UX shape as the production list. |
| `src/lib/supabase/middleware.ts:5` (add `/book-your-event` and `/book-your-event/thanks` to `PUBLIC_PATHS`) | n/a — same file edit | Existing pattern: array literal lists every public path; one-line addition. |
| `src/features/intake/email.ts` (notify Shannon on new intake) | `src/features/email/actions.ts:1` | Existing Resend wrapper conventions (sender, subject prefix, dev-redirect honoring). |

**Conventions referenced:**
- `docs/wiki/architecture.md` — Server Actions for our-UI mutations; route handlers only for external callers. The Squarespace form *is* an external caller, but if we own the form on our surface, the submission is internal → Server Action. (If we keep Squarespace and add a webhook, that's a route handler instead.)
- `docs/wiki/auth.md` — `PUBLIC_PATHS` is the single gate for unauthenticated routes; nothing else needs to change for a public form.
- `docs/wiki/data-model.md` — audit-column defaults (id types, `created_at`, `archived_at`, `public_id`), and the auth.users gotcha if we ever link an intake to a real user later.

**Overall Progress:** 0% (0/6 phases complete)

**Note:**
- Phases 1–4 are sequential. Phase 5 (Squarespace edit) can land any time after Phase 3 ships, but only when the user is comfortable retiring the Squarespace form.
- Phase 4's "Convert to campaign" doesn't have to ship in v1 — Shannon can manually create the campaign in the existing booking flow using the intake row as a reference. The convert-flow is the polish.
- Spam handling in Phase 2: at minimum a hidden honeypot field + rate-limit per IP. Turnstile/hCaptcha is a stretch goal pending decision #5.

### Phase Checklist

#### Phase 1: Schema
- [ ] `src/lib/db/schema/campaign-intakes.ts` — table with `id`, `publicId`, `submittedAt`, `submittedFromIp`, `status` (`new` / `contacted` / `accepted` / `rejected` / `converted` / `spam`), `dealerName`, `contactName`, `email`, `phone`, `requestedStartDate` (nullable), `requestedEndDate` (nullable), `notes`, `convertedCampaignId` (nullable FK), `archivedAt`. Final field list pending decision #1.
- [ ] Wire it into `src/lib/db/schema/index.ts`.
- [ ] `pnpm db:generate` → review generated migration → commit.
- [ ] `pnpm db:migrate` against dev DB.

#### Phase 2: Public form
- [ ] `src/app/book-your-event/page.tsx` — Server Component renders the form; on success redirects to `/book-your-event/thanks`.
- [ ] `src/app/book-your-event/thanks/page.tsx` — confirmation screen.
- [ ] `src/features/intake/actions.ts:submitIntake` — validate, insert, kick off Resend notification, return `ActionResult`.
- [ ] Add `/book-your-event` and `/book-your-event/thanks` to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts:5`.
- [ ] Honeypot field + per-IP rate limit (in-memory bucket is fine for v1).
- [ ] Vitest unit tests for `submitIntake` (validation rejects, valid input persists, honeypot trip returns ok-but-no-write).

#### Phase 3: Email notification
- [ ] `src/features/intake/email.ts:notifyIntake` — uses existing Resend wrapper to mail Shannon (To = `INTAKE_NOTIFY_TO` env var).
- [ ] Honor `EMAIL_FORCE_DEV_REDIRECT` per the existing dev-redirect convention.
- [ ] Unit test for the template + the dev-redirect path.

#### Phase 4: Staff triage
- [ ] `src/app/(app)/admin/intakes/page.tsx` — table of intakes with status filter, search by email/dealer name, primary action `View`.
- [ ] Intake detail dialog — surface every field, plus actions `Mark Contacted` / `Mark Accepted` / `Mark Rejected` / `Mark Spam`.
- [ ] `convertIntakeToCampaign(intakeId, ...)` — transaction: find-or-create `dealer` (by name, case-insensitive), find-or-create `contact` (by email), insert `campaign`, set `intake.status = 'converted'` + `intake.convertedCampaignId`. Surface a "matched existing dealer X" / "created new dealer" indicator.
- [ ] Vitest tests: convert with new dealer, convert with existing dealer match, convert is idempotent (clicking twice doesn't double-insert).

#### Phase 5: Marketing-site cutover
- [ ] Decide subdomain vs same-domain (decision #2).
- [ ] In Squarespace: change the "Book Your Event" CTA `href` (and remove the embedded form widget if going subdomain route).
- [ ] Validate the redirect by clicking the live button → lands on our form.
- [ ] If keeping Squarespace's `/book-your-event` page as a soft fallback, add a banner there pointing to the new URL.

#### Phase 6: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean.
- [ ] eval-smoke green (will need a Phase 1-aware update to its public-surface table — `/book-your-event` becomes a new expected public route).
- [ ] Manual e2e: anonymous submit → row in DB → email lands → log in as staff → see intake in `/admin/intakes` → click `Convert` → resulting campaign visible on `/calendar` and `/production`.
- [ ] Spam smoke: submit with the honeypot field filled → no DB row, no email.

## Out of scope (for this chunk)

- **Self-service booking.** Prospects don't pick coach + date + time directly. They submit a request, staff confirms manually. Self-service requires availability lookups and slot reservation that's a much bigger chunk — possibly Phase 7-adjacent.
- **Login linkage.** Intakes don't create `auth.users` entries. If we later want prospects to track their own request, that's a separate lane (probably ties into Phase 7's quote→contract→invoice→payment loop).
- **Squarespace replacement.** Not migrating the rest of the marketing site. Just the one CTA target.
- **Two-way sync.** No "marketing site stays canonical, app shadows it" arrangement — the app *becomes* the canonical home for booking submissions.
