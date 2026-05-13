# MSA Send — bundled MSA + first-Quote e-signature envelope

**Started:** 2026-05-12

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Dropbox Sign client + env wiring (`src/lib/dropbox-sign/`) | Done | `3e1b6bd` |
| 2: MSA template render (`renderMsaPdf`) + storage layout | Done | `f07a952` |
| 3: `createMsaDraft` + `sendMsaEnvelope` Server Actions | Done | `22c6a0f` |
| 4: Webhook route handler at `/api/dropbox-sign/webhook` | Done | `81f18b1` |
| 5: MSA panel on `/dealerships/[id]` + create-MSA dialog | Done | `784a080` |
| 6: Tests + smoke verification | Pending | - |

This chunk surfaces the **MSA send flow** — the second half of the 0025-quote-to-payment epic Phase 7.2 (Contract). The first half (`master_service_agreements` schema, RLS, status enum, `dropboxSignDocumentId` / `signedPdfStorageKey` / `templateVersion` columns) shipped via closed/0037-commercial-spine-msa Phase 2. Today there's **no Server Action that creates an MSA row, no Dropbox Sign client, no webhook handler, no UI surface** — the schema sits unused. "Done" means a coach can land on `/dealerships/[id]` for a Client without an active MSA, click "Create MSA + send for signature", and the bundled envelope (MSA template + the dealer's first draft Quote) is posted to Dropbox Sign; the Client signer URL surfaces back in the panel; on the `signed` callback the row flips to `active` with `signedAt` + the signed-PDF stashed at `msa/<id>/signed.pdf` in GCS; `msa.signed` audit row emitted. The Quote stays in `draft` and remains separately sendable via the existing `sendQuote` flow once the MSA is signed — i.e. **MSA-sign and Quote-send are independent transitions**; the bundled envelope only handles the signature side. v1 scope: one MSA per dealer, no re-sends, no renewal flow (deferred — see Open Questions).

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/dropbox-sign/client.ts` — `client()` lazy singleton + `createEmbeddedSignatureRequest()` / `getSignedFileBytes()` helpers | `src/lib/storage/gcs.ts:22-50` (`client()` lazy singleton with `GCS_CREDENTIALS_JSON` parse) | Third-party SaaS client with credential init, cached, returns `{ error }` on bad config; same `Result<T>` pattern (`{ ok, ... } \| { error }`) |
| `src/lib/dropbox-sign/templates.ts` — MSA template-id resolution by `templateVersion` | `src/lib/email/templates.ts` (string-template module per send-type) | Sibling registry pattern; centralizes the env-var → template-id mapping so the action layer doesn't reach into env directly |
| `src/lib/pdf/render-msa.ts` — `renderMsaPdf(input: MsaPdfData)` returning `Buffer` | `src/lib/pdf/render-quote.ts` (`renderQuotePdf` returning `{ ok, body } \| { error }`) | Sibling PDF render; same `react-pdf` setup, same Result shape, parallel test file at `src/lib/pdf/render-msa.test.ts` |
| `src/features/msa/actions.ts` — `createMsaDraft` (capability `msa:edit`) + `sendMsaEnvelope` (capability `msa:send`) | `src/features/quotes/actions.ts:174` (`createQuote`) + `:576-770` (`sendQuote`) | Sibling create-draft + lifecycle-flip pair; `sendMsaEnvelope` mirrors `sendQuote`'s atomic guarded `pending → ?` UPDATE + GCS persist + audit emit; the **envelope-post** step replaces the email-send step in `sendQuote` |
| `src/features/msa/queries.ts` — `loadMsasByDealer` + `loadActiveMsa(dealerId)` | `src/features/quotes/queries.ts:36-55` (projection map + `mapRow`) | Sibling read-side; same Drizzle projection-first pattern; status-filter helper for "active MSA exists" lookup driving the dealer-detail-page conditional |
| `src/app/api/dropbox-sign/webhook/route.ts` — Dropbox Sign webhook receiver (`POST`) | `src/app/auth/callback/route.ts:12` (`export async function GET`) | Sibling external-caller route handler; per CLAUDE.md → "Mutations go through Server Actions, not route handlers" the **only** reason this is a route handler is that Dropbox Sign is an external caller; verify HMAC signature before dispatch, then call into a non-`'use server'` internal helper in `src/features/msa/lifecycle.ts` (sibling: `src/features/quotes/lifecycle.ts`) |
| `src/features/msa/lifecycle.ts` — `markMsaSigned(...)` internal helper, called by the webhook | `src/features/quotes/lifecycle.ts` (`markQuoteAccepted` / `markQuoteDeclined` — non-`'use server'` module so the action-gate lint rule doesn't flag it) | Sibling internal-helper pattern; atomic guarded UPDATE (`status='pending' AND dropboxSignDocumentId=$1 → 'active'`) + `signedPdfStorageKey` set + audit emit; called by the route handler after HMAC verify |
| `src/features/msa/msa-create-dialog.tsx` — Radix dialog with "Create MSA + send for signature" form | `src/features/quotes/quote-composer.tsx` (composer dialog pattern + recipient resolution) | Sibling form-in-dialog; uses RHF + zod resolver; resolves recipient via `resolveQuoteRecipient(dealerId)` (already exists) |
| `src/app/(app)/dealerships/[id]/page.tsx` — MSA panel block (read-side surface) | `src/app/(app)/quotes/[id]/page.tsx:69-114` (the 0040 send-receipt panel) | Sibling read-only panel rendered alongside the existing quote-history block; same `<section className="rounded-xl border border-stone-200 bg-stone-50 …">` vocabulary; shows MSA status pill + signed date + signed-PDF download link |
| `master_service_agreements` schema patches (if any) | `src/lib/db/schema/master-service-agreements.ts:12-37` (existing shape) | Existing columns cover the basics; expect to **add nothing** in v1 unless an Open Question forces a column add (e.g. `signer_email` denorm if recipient rotates between draft + send, mirroring 0040's recipient denorm) |
| `quote:send` ↔ MSA-active gate (optional Phase) | `src/features/quotes/actions.ts:576` (`sendQuote`) | The 0026 follow-up (b) "split `quote:send` from `quote:edit`" intersects here — if 7.2 requires MSA-active-before-Quote-send, the gate lives here, but **this plan keeps Quote-send and MSA-sign independent** per the v1 scope decision above; cross-plan dependency captured in Open Questions #5 |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `master_service_agreements` row description (existing); MSA-per-dealer cardinality.
- `docs/wiki/lifecycle.md` — `msa.signed` audit-action will be a **new enum value** added to `auditAction` in Phase 3 (Drizzle `ALTER TYPE … ADD VALUE` migration; matches the pattern used for `dealer.activated` in closed/0035).
- `docs/wiki/auth.md` — capability matrix needs two new entries: `msa:edit` (admin + coach) for create + send, `msa:read` (admin + coach + viewer) for the panel projection. The capability matrix file in `src/lib/auth/capabilities.ts` is the source of truth.
- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers" — the Dropbox Sign webhook is an external caller, so it's the rare legitimate route-handler use case. Verify the HMAC signature before mutating anything.
- `CLAUDE.md` → "Database, schema, migrations, Drizzle, Supabase auth wiring — invoke the `db-conventions` skill before writing or modifying."
- Project memory `project_msa_structure` — 12-month MSA term per §2.i; accepted Quote IS the contract per §1.iii (no separate `orders`); 50% cancel fee within 21 days of Event start.

**Overall Progress:** 83% (5/6 phases complete)

## Open Questions

These are inherited from closed/0037-commercial-spine-msa (eight OQs there) plus 0041-specific ones. Phase 1 should triage which need answers before scoping the implementation.

1. **MSA termination notice — exactly how many days?** Per §2.ii, the MSA can be terminated with `XX days` written notice; the prose carries an `XX` placeholder. v1 candidate: 30 days. Locks the rendered template + the `terminationNoticeDate` validation.
2. **MSA renewal flow.** 12-month term per §2.i — what happens when `expiresAt` arrives? Auto-create a renewal MSA? Notify the coach? Block new quote-sends past expiry? **Recommendation for v1:** out of scope — when `expiresAt` arrives, surface a banner on the dealer detail page; no auto-renewal. Renewal is its own chunk later.
3. ~~**Envelope shape specifics.**~~ **Resolved 2026-05-12 — inline upload.** The MSA PDF is rendered by `renderMsaPdf` (Phase 2) and posted inline per envelope alongside the first-Quote PDF. No Dropbox-Sign-side template; the prose stays under git via `src/lib/pdf/render-msa.ts`. Reason: legal prose maintained in-repo rather than through a Dropbox Sign login; `templateVersion` traceable to a commit; first-Quote half of the envelope is inline regardless, so a mixed approach would have been the only alternative.
4. ~~**`templateVersion` strategy.**~~ **Resolved 2026-05-12 — `MSA_TEMPLATE_VERSION` env var, bumped manually on each prose revision.** Denormalized into `master_service_agreements.templateVersion` at draft-create time. Audit trail stays self-contained; env-var bumps are visible in deploy diffs.
5. **MSA-active gate on `sendQuote`?** The v1 scope decision is "MSA-sign and Quote-send are independent" — but per project memory `project_msa_structure`, MSA must be signed **before first quote-accept**. Should `acceptQuote` (or `sendQuote`) refuse to fire when the dealer has no `status='active'` MSA? **Recommendation:** yes for `acceptQuote`, no for `sendQuote` — sending a quote-PDF is harmless without an MSA; accepting it (the contract trigger) needs the MSA in place. This intersects with 0026 follow-up (b) "split `quote:send` from `quote:edit`" and is a small follow-up chunk, not in 0041 scope.
6. **Cancellation-fee math.** §5: 50% of total quote fee within 21 days of event start. Where does the math live? Probably 7.3 Invoice or 7.4 Payment, not 0041 — but flag for cross-plan reconciliation.
7. **Quotes-per-MSA-term cap.** The MSA umbrella covers all Quotes for one Client over 12 months. Is there a v1 cap? **Recommendation:** no cap in v1; revisit if a Client hits the boundary.
8. **Webhook security.** Dropbox Sign uses HMAC-SHA256 on the payload with a shared secret. The webhook handler must verify the signature before dispatching. Env: `DROPBOX_SIGN_WEBHOOK_SECRET`. The signature header is `X-Dropbox-Sign-Signature` (verify before mutating).

## Phase 1: Dropbox Sign client + env wiring

- [x] Add Dropbox Sign SDK dependency (`@dropbox/sign` v1.10.0 — the official, actively maintained Node client; `hellosign-sdk` is the legacy pre-rebrand package)
- [x] Create `src/lib/dropbox-sign/client.ts` — lazy singleton (anchored on `gcs.ts:22-50`), env vars `DROPBOX_SIGN_API_KEY` + `DROPBOX_SIGN_CLIENT_ID` + `DROPBOX_SIGN_WEBHOOK_SECRET` documented in `.env.example`. Phase 1 ships the API-key-driven `SignatureRequestApi` init only; `DROPBOX_SIGN_CLIENT_ID` (embedded-signing iframe id) + `DROPBOX_SIGN_WEBHOOK_SECRET` (HMAC verify) are documented in `.env.example` for the operator but only read in Phases 4/5 when the webhook + dialog land. Helpers `createEmbeddedSignatureRequest()` / `getSignedFileBytes()` from the Code Anchor row will land in Phase 3 alongside `sendMsaEnvelope` (their first caller).
- [x] Add `src/lib/dropbox-sign/templates.ts` — `MSA_TEMPLATE_VERSION` env mapping (exports `currentMsaTemplateVersion()`; per OQ#3 resolved inline-upload, no Dropbox-side template id lookup needed)
- [x] Unit-test the credential parse + a `client()` cache hit (also covers `currentMsaTemplateVersion` env trim + unset cases; 7 new tests, 695/696 PASS)
- [x] ~~Resolve Open Question #3 (template vs upload-inline) and #4 (`templateVersion` source) before Phase 3 kicks off~~ — both resolved 2026-05-12 in plan body before Phase 1 kicked off

## Phase 2: MSA template render (`renderMsaPdf`) + storage layout

- [x] Create `src/lib/pdf/render-msa.ts` mirroring `render-quote.ts` shape — input type `MsaPdfData` (client name, address, signer name + email, term start/end, termination-notice days, governing law, templateVersion); §-clauses (§1 Services, §2 Term+Termination, §3 Payment, §5 Cancellation, §9 Governing Law) hardcoded in `buildSections` matching `docs/wiki/commercial-spine.md` citations; multi-page renderer with auto-paginate on body + signature-block overflow
- [x] Test `render-msa.test.ts` matches the `render-quote.test.ts` pattern (PDF magic header, US-Letter round-trip, ≥1 page, missing `clientAddress` optional, opt-in `/tmp/msa-smoke.pdf` writer gated on `WRITE_SMOKE_PDF=1`)
- [x] GCS key shape: `msa/<msaId>/draft.pdf` for the draft (pre-sign), `msa/<msaId>/signed.pdf` for the post-sign artifact (parallels `quotes/<quoteId>/<rev>.pdf`) — decision-only deliverable; the keys are written by Phase 3 (`sendMsaEnvelope`) and Phase 4 (`markMsaSigned`)

## Phase 3: `createMsaDraft` + `sendMsaEnvelope` Server Actions

- [x] Add `msa:edit` + `msa:read` to `src/lib/auth/capabilities.ts`; admin + coach for edit, admin + coach + viewer for read (capabilities.test.ts gained 14 admit-set cases mirroring the `reports:view` / `availability:edit` pattern)
- [x] Add `msa.created` + `msa.sent` + `msa.signed` + `msa.declined` to the `auditAction` pgEnum via `drizzle/0019_msa_audit_actions.sql` (`ALTER TYPE … ADD VALUE` mirroring `0016_flat_typhoid_mary.sql`); journal `when` hand-bumped to `1779724800000` (monotonic) and snapshot `0019_snapshot.json` patched to include the four new values + `prevId` chain. `AuditActionId` string-literal union in `src/features/audit/actions.ts` extended to match.
- [x] `createMsaDraft(dealerId)` — capability `msa:edit`; FOR UPDATE dealer lock + same-tx existing-MSA check refuses when dealer already has `pending`/`active` row (one-MSA-per-dealer v1 — expired/terminated rows allow renewal-style fresh drafts); stamps `templateVersion` from env via `currentMsaTemplateVersion()`; emits `msa.created` audit; returns `{ ok, msaId }`
- [x] `sendMsaEnvelope(msaId, firstQuoteId)` — capability `msa:edit`; pre-loads MSA + dealer + first draft Quote; idempotent early-return when `dropboxSignDocumentId` is already set; renders MSA PDF (`renderMsaPdf` from Phase 2) + Quote PDF (`renderQuotePdf` from persisted snapshot); uploads MSA draft to `msa/<id>/draft.pdf` in GCS; posts a single envelope with both PDFs to Dropbox Sign via `sendSignatureRequest` (added to `dropbox-sign/client.ts` — inline-upload `signatureRequestSend` wrapper); persists `dropboxSignDocumentId` via atomic guarded UPDATE (`status='pending' AND dropbox_sign_document_id IS NULL`); emits `msa.sent` audit with `signatureRequestId` + `draftPdfStorageKey` payload. The `getSignedFileBytes` helper also landed in `client.ts` for Phase 4's webhook to fetch the signed PDF.
- [x] Test cases: happy path, missing first-Quote, archived dealer, Dropbox Sign API failure (no state mutation), idempotent re-send (already has `dropboxSignDocumentId`) — plus 4 additional negative cases: cross-dealer Quote rejection, sent-Quote rejection, missing-dealerId on create, existing-MSA refusal on create (14 cases total in `actions.test.ts`; 725/727 vitest)

## Phase 4: Webhook route handler at `/api/dropbox-sign/webhook`

- [x] Create `src/app/api/dropbox-sign/webhook/route.ts` — `export async function POST(request: NextRequest)` (anchored on `src/app/auth/callback/route.ts:12`); response body always uses the literal `Hello API Event Received` ack string Dropbox Sign expects (retries on anything else)
- [x] Verify HMAC signature **before** any read or mutation — Dropbox Sign signs `event_time + event_type` with HMAC-SHA256 and `DROPBOX_SIGN_WEBHOOK_SECRET`; pulled into `src/lib/dropbox-sign/webhook-verify.ts` with `crypto.timingSafeEqual` for constant-time compare (NOT a header-based scheme like X-Hub — Dropbox Sign's `event_hash` rides inside the JSON payload's `event` object); rejects 401 on mismatch / 500 on missing-secret
- [x] Dispatch by event type: `signature_request_all_signed` (the all-parties-complete event — note: Dropbox Sign emits `signature_request_signed` for each signer, but the v1 MSA flow has one signer so the `_all_signed` event is the canonical "envelope complete" signal) → lookup MSA, short-circuit if already-active, download signed PDF via `getSignedFileBytes`, upload to GCS at `msa/<id>/signed.pdf`, call `markMsaSigned`; `signature_request_declined` → call `markMsaDeclined`; other events → 200 ack + no-op
- [x] `markMsaSigned` + `markMsaDeclined` helpers in `src/features/msa/lifecycle.ts` — atomic guarded UPDATE on `(status='pending' AND dropbox_sign_document_id=$1)`; signed flip stamps `signedAt`, `expiresAt` (signedAt + 12 months per §2.i), and `signedPdfStorageKey`; both helpers emit the audit row directly (no session/user available in webhook context — `actor_user_id` writes NULL with `actor_role='system'`)
- [x] Test cases: 11 webhook-route cases (valid signature flow, invalid signature → 401, missing secret → 500, malformed JSON → 400, unknown doc id → 404, replay-on-active → idempotent 200, declined → 200, declined unknown → 404, unrelated events → 200 no-op, missing signature_request_id → 400, Dropbox-Sign fetch failure → 502 with no upload + no flip) + 7 lifecycle cases (signed happy path, signed replay-idempotent, signed unknown, signed-from-terminated, declined happy, declined idempotent, declined unknown) + 7 webhook-verify cases (happy + 5 tamper scenarios + length-mismatch short-circuit); 750/752 vitest

## Phase 5: MSA panel on `/dealerships/[id]` + create-MSA dialog

- [x] Add `loadMsasByDealer(dealerId)` + `loadActiveOrPendingMsa(dealerId)` (renamed from `loadActiveMsa` to capture both the panel's "show the row" state and the "show signed badge" state in one call — pending falls back when no active) + `firstDraftQuoteIdForDealer(dealerId)` to `src/features/msa/queries.ts` (server-only module)
- [x] Insert MSA panel block on `/dealerships/[id]/page.tsx` — rendered **above** the existing quote-history block (placement intentional: the MSA is the umbrella contract; Quotes hang off it per `commercial-spine.md`); status pill + Created/Signed/Expires dates + Template version + signed-PDF download link (signed-URL resolved server-side via `signedUrl` direct call — the page is `admin:access` gated so no separate Server Action is needed today; sibling pattern to `/quotes/[id]/page.tsx:67-72`)
- [x] "Create MSA" button → opens `MsaCreateDialog` (in `src/features/msa/msa-create-dialog.tsx`, wrapped by `MsaCreateTrigger` for `useState`-driven open); on submit calls `createMsaDraft(dealerId)` followed by `sendMsaEnvelope(msaId, firstDraftQuoteId)` (single-click two-step flow); failures surface via `sonner` toast + inline error
- [x] Disabled-state UX: if no draft Quote exists yet for this dealer, the dialog surfaces "No draft Quote yet — create one first" and links to `/quotes/new?dealerId=<id>`; if no recipient (no customer contact with primary email) the dialog surfaces the error and disables Send. Send button disabled when either condition fails (`canSubmit = !noRecipient && !noDraftQuote`).
- [x] Status pill: `pending` (amber) / `active` (emerald) / `expired` (stone) / `terminated` (red) — fresh `MSA_STATUS_PILL_CLS` map sibling to `STATUS_PILL_CLS` in the same file (the MSA statuses are different from quote statuses so a shared map would mismatch)

## Phase 6: Tests + smoke verification

- [ ] Service-level integration test for `createMsaDraft` + `sendMsaEnvelope` (mocked Dropbox Sign client + real DB)
- [ ] Webhook signature-verification tests (valid + invalid + replay)
- [ ] `markMsaSigned` atomic-flip test — concurrent webhook calls produce idempotent result
- [ ] Smoke (web-test): `goto /dealerships/1`; no MSA panel rendered when dealer has no MSA; "Create MSA" button present
- [ ] Smoke (web-test): after `markMsaSigned` (via fixture script), the MSA panel renders `Status: Active` + `Signed: <date>` + `Download signed MSA` link
- [ ] `scripts/0041-msa-smoke.ts insert` / `cleanup` — throwaway fixture pattern (a `pending` MSA + a `signed` MSA both seeded against dealer #1; cleanup deletes both + the GCS objects)

**Note:** No live Dropbox Sign smoke in this plan — that's a 0026-follow-up-(d)-style "credentials wired in sandbox" follow-up chunk. The mocked-client integration tests + the fixture-driven UI smoke are sufficient to declare 0041 shipped; the live integration verification lands later when Dropbox Sign sandbox creds are in `.env.local`.
