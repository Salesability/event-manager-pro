# Open questions for the team — port migration

Decisions surfaced by `eval-2026-05-02-1200.md` (and a few longer-running open Qs from the umbrella tracker) that benefit from a human in the loop before Phase 6 cutover. Each entry has a current state, the actual question, options with trade-offs, and a recommendation. The recommendation is a starting point, not a decision.

When a question is resolved, move the entry into the body of the umbrella plan (or the relevant sub-plan) and delete it here.

---

## 1. Should `/share/coach/[id]` keep using sequential IDs?

**Current state.** `src/app/share/coach/[id]/page.tsx:15` accepts a numeric `contacts.id`. The route is in `PUBLIC_PATHS` (no auth). Anyone who knows the URL can see the coach's name + every non-cancelled campaign assigned to them (dealer, dates, ribbons). Today the URL doubles as the authorization — "if you got the link, you're allowed to see it" — but the link is `/share/coach/1`, `/share/coach/2`, …, so it isn't a secret.

**Question.** Do we keep ID-based URLs and accept the enumeration risk, or migrate to unguessable tokens before flipping `events.salesability.ca` to the new app?

**Options.**
- **A. Unguessable share token** (Codex's recommendation, my default). Add `share_token` column on `contacts`, generate at coach-create / backfill once, change the route param to `[token]`, update all URL builders (`src/features/email/actions.ts`, `coachShareLink` template, any UI that surfaces the URL). Old `/share/coach/<numeric-id>` URLs break.
  - **Pro:** enumeration impossible. Tokens rotatable. No password / no auth flow needed.
  - **Con:** requires a small migration + URL-builder sweep. Old links in coach inboxes (sent during the legacy era) stop working.
- **B. Auth the route.** Require sign-in to see anyone's schedule. Coaches access their own via the regular `(app)/calendar` filter.
  - **Pro:** strongest. No leak surface at all.
  - **Con:** coaches don't sign in today. Legacy share-link UX disappears entirely. Material UX change.
- **C. Status quo.** Document the trade-off, accept it, monitor.
  - **Pro:** zero work.
  - **Con:** the bet is "no one will scrape." Once `events.salesability.ca` flips, the URL space is publicly crawlable.

**Recommendation.** **A.** It's a small chunk (schema + backfill + route param + 3 URL-builder sites) and removes a Phase-6 blocker. Keep ID-based URLs working for ~30 days as a redirect (`/share/coach/<id>` → 404 or → 410 Gone) so we get telemetry on whether old links are still being clicked, but don't render the schedule for them.

**Decision needed by.** Phase 6 cutover.

---

## 2. Should dev-environment email default to fail-closed?

**Current state.** Commit `1c22b66` made dev-redirect *opt-in*: `src/lib/email/send.ts:29` only rewrites recipients when `EMAIL_FORCE_DEV_REDIRECT=true` and `EMAIL_DEV_TO` is set. Outside production, if you forget the flag, the `Email Client` button on `/production` Event Detail sends to the real campaign contact. Today the Resend sandbox sender (`onboarding@resend.dev`) restricts deliverable recipients to the email registered on the Resend account, which is the only thing keeping accidental sends contained. Once `salesability.ca` is verified (open Q #5), that guardrail evaporates.

**Question.** Keep the deliberate fail-open default, or invert it before the domain is verified?

**Options.**
- **A. Fail-closed (invert).** Outside `APP_ENV=production`, redirect to `EMAIL_DEV_TO` automatically. Add a separate explicit opt-out (`EMAIL_ALLOW_REAL_SEND=true`) for the rare case a dev wants to test a real send.
  - **Pro:** safe by default. The cost of a wrong default is a missed real send (annoying); the cost of the current default is a real client receiving a `[DEV→…]` test message.
  - **Con:** breaks the workflow that motivated `1c22b66` (someone wanted to test against a real recipient without ceremony).
- **B. Status quo (fail-open by default).** Trust the env-var discipline.
  - **Pro:** zero work, matches the deliberate change in `1c22b66`.
  - **Con:** every staging deploy / new dev box / new contributor is a footgun until `EMAIL_FORCE_DEV_REDIRECT=true` is set.
- **C. Tie behavior to `APP_ENV`.** `APP_ENV=development` → fail-closed. `APP_ENV=staging` → fail-closed. `APP_ENV=production` → real send. No flag at all.
  - **Pro:** one knob. Same shape as the rest of the app's env-keying.
  - **Con:** removes the testing affordance entirely; a dev who needs a real send has to bump to `production` locally (gross).

**Recommendation.** **A.** What `1c22b66` actually wants is "don't make me set a flag every time" — A delivers that for the common case (dev = redirect) and only requires a flag for the *exception* (real send), which is the right way around.

**Decision needed by.** Before Resend domain verification (Q #5), since that removes the sandbox-recipient guardrail.

---

## 3. Should emailed share URLs come from a configured `APP_BASE_URL` or the request `Host:` header?

**Current state.** `src/features/email/actions.ts:21` builds the share URL from `headerList.get('host')`. A signed-in user (or anyone who can persuade one to invoke the Server Action with a forged `Host:`) gets the email composed against an attacker-controlled origin: `https://attacker.example/share/coach/<id>`.

**Question.** Move to a configured canonical origin, or keep deriving from the request?

**Options.**
- **A. Configured `APP_BASE_URL` (or use the existing `NEXT_PUBLIC_SITE_URL` if present).** Read it once at module load; all email URL builders use it.
  - **Pro:** robust against header forgery. Single source of truth for "where does this app live."
  - **Con:** another env var to track per environment (already need `local`, `staging`, `prod`).
- **B. Status quo.** Trust the request host.
  - **Pro:** zero config, zero work.
  - **Con:** see the attack scenario above. Also subtly broken behind a proxy that doesn't pass `X-Forwarded-Host` correctly.

**Recommendation.** **A.** This pattern is standard; the work is one helper + three call-site updates.

**Decision needed by.** Same window as Q #2 (paired email-hardening pass).

---

## 4. What should happen if someone edits a campaign that was cancelled in another tab?

**Current state.** `src/features/schedule/actions.ts:430`'s `updateCampaign` has no status predicate. The TOCTOU is: open Edit → in another tab/browser, click Cancel Campaign → submit the stale Edit. The cancelled record gets silently mutated (status stays `cancelled`, but other fields change).

**Question.** What's the right UX when an edit lands on a cancelled record?

**Options.**
- **A. Reject, show error.** `updateCampaign` checks status; if `cancelled`, return an error. UI shows a toast: "This campaign was cancelled. Your edits were not saved." User can re-open in a fresh state if they want to un-cancel.
  - **Pro:** safe. User informed.
  - **Con:** edits are lost. Mild user frustration ("I just typed that").
- **B. Reject + restore.** Same check, but the error response carries the rejected form values back so the UI can offer "un-cancel and re-apply" or "discard."
  - **Pro:** no lost work.
  - **Con:** more UI plumbing for a rare race.
- **C. Allow edit on `cancelled`.** Treat cancelled campaigns as fully editable historical records.
  - **Pro:** matches the "audit trail" intuition (we don't lose the edit).
  - **Con:** semantically muddy. What does "edit a cancelled campaign" mean for downstream reports?

**Recommendation.** **A.** This race is rare and the simplest behavior is correct enough. If it turns out to be a real annoyance in practice, B is an additive upgrade.

**Decision needed by.** Soft — pre-cutover hygiene, not a blocker.

---

## 5. When does the Resend domain (`salesability.ca`) get verified, and who owns the DNS records?

**Current state.** All sends go through `onboarding@resend.dev` (sandbox sender). Recipients are restricted to the email registered on the Resend account, which is currently the only thing containing the dev-email fail-open in Q #2. The 5.5 plan called this out as deferred; CURRENT.md notes "until `salesability.ca` is verified in the Resend dashboard."

**Question.** Who adds the SPF / DKIM / DMARC records to the `salesability.ca` zone, and on what timeline?

**Options.** Mostly mechanics — there's no real fork here, just sequencing.

**Recommendation.** Pair this with Phase 6 cutover. Verifying the domain a few days *before* DNS flip lets us do real-recipient send tests against a small allowlist (Q #2's `EMAIL_ALLOW_REAL_SEND=true` opt-out path) without exposing real clients. Holding off until Q #2 lands keeps the failure mode bounded.

**Decision needed by.** Whoever holds the `salesability.ca` zone — needed before Phase 6.

---

## 6. What's the cutover plan for Phase 6?

**Current state.** Phase 6 in the umbrella tracker is "Cut over `events.salesability.ca` to the new deploy" with no detail. Phase 7 (quote → contract → invoice → payment) and Phase 8 (rotate API_KEY + HELLOSIGN_API_KEY, lock the spreadsheet) come after.

**Questions for the team.**
- Maintenance window or blue/green?
- Is the legacy spreadsheet truly read-only as of cutover, or do we keep it writable as a fallback for some grace period?
- Who watches the new app for the first ~week? What's the rollback signal — "we got 3 user reports" / "error rate above X" / "manual"?
- Coach communication — do existing share-link emails (sent during the legacy era) need to keep working through cutover? (Connects to Q #1's redirect behavior.)

**Recommendation.** A short cutover-runbook doc — separate file, lives in the umbrella folder — written before the work starts. Not a planning artifact; it's an operational checklist with named owners.

**Decision needed by.** Before scheduling the cutover.

---

## 7. Does the `messages_sent` audit table ship with 5.6/5.7/5.8, or as its own chunk?

**Current state.** The 5.5 plan listed `messages_sent` as deferred ("schema work TBD if the table doesn't exist yet"). The Codex Low #1 finding (email idempotency) wants the same table — a unique key per (campaign, template, recipient) is what enables dedup. The "Last emailed: …" affordance on campaign rows also wants this table.

**Question.** Roll into one of the parked Phase-5 sub-plans (5.6 export, 5.7 summary reports, 5.8 share-link-full), or schedule its own chunk?

**Options.**
- **A. Own chunk, before any of 5.6/5.7/5.8.** Schema + minimal "Last emailed" UI + send-side idempotency wiring.
  - **Pro:** unblocks the email-side idempotency Codex flagged. Small, well-scoped.
  - **Con:** another sub-plan in the queue.
- **B. Bundle with 5.7 (summary reports).** Reports want to query "who got what when," which is exactly what `messages_sent` is for.
  - **Pro:** natural pairing.
  - **Con:** delays idempotency until 5.7 ships.
- **C. Defer to Phase 7.** Phase 7's outbound stack (quotes/contracts/invoices) will need an audit table anyway — design once.
  - **Pro:** avoids designing twice.
  - **Con:** Phase 7 is far. Leaves 5.5's idempotency hole open for the duration.

**Recommendation.** **A.** It's small, it closes a Codex finding, and Phase 7's audit needs are likely to extend the same table rather than replace it.

**Decision needed by.** When we pick the next active sub-plan (the slot is currently vacant in `CURRENT.md`).

---

## 8. Editable email preview modal — ship it or skip it?

**Current state.** The legacy `confirmModal` had editable `To` / `Subject` / `Body` before send. The 5.5 plan deferred this in favor of confirm-then-send (`confirm()` shows target + address, then sends). The deferred list is explicit about it not blocking 5.5 Done.

**Question.** Is the confirm-then-send UX permanent, or is the editable preview a real requirement?

**Options.**
- **A. Ship the editable modal.** Replace `confirm()` with a real modal that shows the rendered template and lets the user edit before send.
  - **Pro:** matches legacy UX. Coaches/sales reps probably *do* edit ad hoc.
  - **Con:** non-trivial UI work. Re-opens the question of whether we store the edited body in `messages_sent` (Q #7).
- **B. Ship a "preview-only" modal.** Show the rendered template, no editing — just a "Send" button.
  - **Pro:** addresses "what am I about to send?" without the editing complexity.
  - **Con:** doesn't match legacy.
- **C. Status quo.** Keep `confirm()`.
  - **Pro:** zero work. Already shipped.
  - **Con:** users used to legacy may feel handcuffed.

**Recommendation.** **B** as a near-term step, **A** if user feedback after cutover demands editing. Users who really need to edit can copy-paste into Gmail today.

**Decision needed by.** Soft — driven by user feedback post-cutover, not a blocker.

---

## 10. Which brand does the app render — "SaleDay Events" or "Salesability Events"?

**Current state.** Today the app renders the **SaleDay Events** mark across the gated header (`src/components/app/app-header.tsx`), the login card (`src/app/login/page.tsx`), the `/share/coach/[id]` public header, and the favicon (`src/app/favicon.ico`) — all sourced from the legacy `deprecated/index.html` (commits `796138d` + `f85fc0b` on 2026-05-03). Meanwhile the live marketing site at [salesability.ca](https://www.salesability.ca/) brands itself as **Salesability Events** with the tagline "Helping dealers connect with their customers" — no "SaleDay" anywhere. The `salesability.ca` favicon is the Squarespace `default-favicon.ico`, so we can't lift it.

User has confirmed (2026-05-03) that the **"Book Your Event" CTA on `salesability.ca/book-your-event` will be the entry point into this app.** Prospects transition straight from the marketing site into our app, so visual continuity matters.

**Question.** Which brand does this app render once it goes live at `events.salesability.ca`?

**Options.**
- **A. Match the marketing site — Salesability Events.** Get a real Salesability mark + favicon from whoever owns the `salesability.ca` brand assets. Swap header, login, share, favicon.
  - **Pro:** continuity with the entry-point CTA. No "wait, what app is this?" moment for prospects.
  - **Con:** depends on brand assets that don't exist publicly today (`salesability.ca` itself is using the Squarespace default favicon).
- **B. Keep SaleDay.** Treat "SaleDay Events" as a sub-brand or product line under Salesability — the booking app retains its own identity.
  - **Pro:** matches what the legacy app shipped with. Zero work.
  - **Con:** nothing on `salesability.ca` references the SaleDay name. Reads as a different product.
- **C. Strip branding to text-only.** Remove the SaleDay mark, render "Salesability Events" as plain typography, ship a generic-letter favicon. Defer the real brand mark.
  - **Pro:** doesn't lock us into the wrong brand. Easy to swap later.
  - **Con:** less polished.

**Recommendation.** **A**, contingent on getting brand assets. **C** as the bridge if assets are not forthcoming. **B** is the de-facto state today and works as long as Phase 6 cutover doesn't depend on visual continuity with the marketing site — which the entry-point CTA decision ([memory: salesability.ca → app entry point](#)) suggests it does.

**Decision needed by.** Same window as the entry-point chunk and Phase 6 cutover. The app should not flip to `events.salesability.ca` rendering a brand the marketing site doesn't acknowledge.

---

## 9. Which sub-plan is next?

**Current state.** `CURRENT.md` `Active sub-plan` is vacated. Parked options: 5.6 production export + print, 5.7 summary reports, 5.8 full-calendar share, calendar slot-pack clamp.

**Question.** Sequencing — what unblocks Phase 6 fastest?

**Recommendation.** This belongs in `CURRENT.md`, not here. But for context: Q #1 (share-token) is the only **must-fix-before-cutover** item from this list. If we treat that as the implicit "next sub-plan," everything else slots in after.
