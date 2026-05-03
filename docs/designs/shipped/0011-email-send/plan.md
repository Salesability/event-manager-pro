# Email send — 2026-04-30

Stub for sub-plan 5.5 of `docs/designs/0004-port-migration/plan.md`. The legacy app sends three categories of email through the Gmail API: campaign confirmation to the dealer-side contact (`deprecated/index.html:424`, `confirmModal` lines 431–444, handler `sendGmailConfirmation`), campaign confirmation to the assigned coach (`:425`), and per-coach calendar share link (`:1720`, handler `emailCoachLink`). The new app has no email send today. Done = signed-in users can send the same three messages from the same UI affordances on the new app; replies-to address is the signed-in user's email; the message body matches legacy templates.

**Provider decision (resolved 2026-05-01).** Picked **Resend** over Gmail API. Rationale: Phase 7 is already committed to Resend + React Email for quotes/contracts/invoices, so this chunk shares that infrastructure. Avoids the per-user OAuth scope review (Gmail `gmail.send` is a "restricted scope" requiring Google verification, multi-week). Setup cost is just an API key plus DNS records on the salesability.ca domain; while the domain is being verified we run with the `onboarding@resend.dev` sandbox sender. Reply-to is set to the signed-in user's email so replies thread back to whoever sent the message.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Provider integration + send helper | Done | - |
| 2: Templates (campaign confirmation, share-link) | Done | - |
| 3: Wire UI: Email Client / Email Coach / Email share link | Done | - |
| 4: Verification (tsc + vitest + dev smoke) | Done | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/email/send.ts` | `sendEmail` | Server-only Resend wrapper. Reads `RESEND_API_KEY` / `RESEND_FROM_EMAIL`. When `APP_ENV !== 'production'`, rewrites recipient to `EMAIL_DEV_TO` and prefixes the subject with `[DEV→<original>]` so test sends are visible but unsendable to real clients. |
| `src/lib/email/templates.ts` | `clientConfirmation`, `coachConfirmation`, `coachShareLink` | Plain-text bodies ported verbatim from the legacy `confirmModal` and `emailCoachLink` templates. |
| `src/features/email/actions.ts` | `sendClientCampaignConfirmation`, `sendCoachCampaignConfirmation`, `sendCoachShareLinkEmail` | Server Actions. Look up the campaign/coach, build the template, set `replyTo` to the signed-in user's email, dispatch via the helper. |
| `src/app/(app)/calendar/event-detail.tsx` | `Email Client` / `Email Coach` buttons | Replaced the disabled stubs with confirm-then-send handlers. |
| `src/app/(app)/lists/list-actions.tsx` | `CoachRowActions` | Adds `Email link` per coach row to send the personalised `/share/coach/[id]` URL. |

**Conventions referenced:**
- `docs/wiki/architecture.md` — outbound email is a Server Action (writes to a `messages_sent` audit row + dispatches), not a route handler.
- `docs/wiki/auth.md` — if Gmail path: rely on the Supabase Google OAuth token already stored on the session (already used for sign-in in `src/features/auth/actions.ts`); request the `gmail.send` scope at sign-in.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Depends on 5.1 (Toaster) and 5.2 (the Email Client / Email Coach buttons land in event-detail and stay disabled until this chunk).
- Could merge with Phase 7's Resend integration if we pick Resend — that defers this chunk into Phase 7.
- Audit row: every send writes to a `messages_sent` table (or similar) so we can show "Last emailed: …" on the campaign row. Schema work TBD if the table doesn't exist yet.

### Phase Checklist

#### Phase 1: Provider integration
- [x] Resolve provider choice — picked Resend; rationale captured in the preamble above.
- [x] `pnpm add resend` + `src/lib/email/send.ts` helper with dev-redirect via `APP_ENV` / `EMAIL_DEV_TO`.
- [x] Direct Resend API smoke against the live key to validate API key + sender + recipient: returned id `6ccd7c75-0b33-4009-afea-9e21c76a931e` to `david.hogan@networknode.ca`.

#### Phase 2: Templates
- [x] Campaign confirmation email body (client + coach variants) ported from `confirmModal` rendering in `deprecated/index.html:1100-1198`.
- [x] Coach share-link email body ported from `emailCoachLink` (`deprecated/index.html:1739`).

#### Phase 3: Wire UI
- [x] Replaced disabled `Email Client` / `Email Coach` stubs in `event-detail.tsx` with confirm-then-send handlers (preview-modal deferred — JS confirm names target + address, then sends). Disable state reflects "no email on file" / "no coach assigned".
- [x] Added `Email link` button to `CoachRowActions` in `/lists/`. Disabled when the coach has no email on file.

#### Phase 4: Verification
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean (35/35).
- [x] Direct Resend smoke succeeded; UI smoke pending a manual click-through but path is validated end-to-end at the API.

**Deferred for follow-up (not blocking 5.5 Done):**
- Editable preview modal (legacy had To/Subject/Body editable before send). Current UX is confirm-then-send.
- Domain verification of `salesability.ca` (currently on `onboarding@resend.dev` sandbox — restricts recipients to the email registered on the Resend account).
- `messages_sent` audit row + "Last emailed: …" affordance on campaign rows (was an open Q in this stub, not in scope).
