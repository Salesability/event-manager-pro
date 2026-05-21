# Dropbox Sign → BoldSign migration — Intent

**Created:** 2026-05-15

## Problem

The MSA send/sign flow (shipped in `closed/0041-msa-send-bundled-envelope`) is wired against **Dropbox Sign** (`@dropbox/sign` SDK) — `src/lib/dropbox-sign/`, the `/api/dropbox-sign/webhook` route, and the `master_service_agreements.dropbox_sign_document_id` column. We want to move the e-signature provider to **BoldSign** without changing what the document *is*: the MSA prose stays rendered in-repo by `src/lib/pdf/render-msa.ts` and gets uploaded inline per envelope (no provider-side template, no template-version round-trip). The first-Quote PDF stays bundled into the same envelope, the recipient flow stays single-signer, and the lifecycle states on `master_service_agreements` stay (`pending → active | terminated`).

## Desired outcome

- `sendMsaEnvelope` posts to BoldSign (inline-upload, single signer, optional metadata), not Dropbox Sign.
- A BoldSign webhook lands on a new route handler, verifies the BoldSign signature scheme, and flips MSA rows to `active` (with signed-PDF archival to GCS) or `terminated` on decline — replay-safe and idempotent, same shape as today.
- Existing MSA lifecycle invariants hold: one MSA per dealer (pending/active), atomic guarded UPDATE, audit emission, signed-PDF storage at `msa/<msaId>/signed.pdf`.
- The `@dropbox/sign` dependency, the `src/lib/dropbox-sign/` module, the `/api/dropbox-sign/webhook` route, and `DROPBOX_SIGN_*` env vars are removed by chunk-end.
- The MSA continues to render inline in-app — **no BoldSign template is provisioned or referenced** in code, env, or admin config.
- `docs/wiki/architecture.md` + `docs/wiki/commercial-spine.md` + `docs/wiki/log.md` describe the BoldSign integration in place.

## Non-goals

- BoldSign templates / template versioning on the provider side — the inline-upload model stays. `MSA_TEMPLATE_VERSION` continues to denormalize the in-repo prose revision per row.
- Embedded signing (iframe) — v1 stays on the BoldSign hosted-page signer flow. Forward-compat env vars only.
- Multi-signer envelopes — single signer (the dealer's primary contact) remains the shape.
- Resolving open 0041 follow-ups — concurrent-send race (a), shared env-normalize helper (b), resend button (c), coach-scoped picker (d), live sandbox smoke (e). Those stay in `CURRENT.md` **Parked:** and are tracked independently.
- Backfilling historical MSAs from Dropbox Sign documents to BoldSign documents. Dropbox Sign was never used in production (D #3) — there is nothing to backfill.
- Changing the schema layout of `master_service_agreements` beyond what the document-id column requires.

## Success criteria

- `pnpm tsc --noEmit` clean; `pnpm test` green; lint zero errors.
- `grep -rin "dropbox" src/ docs/wiki/ .env.example` returns zero matches outside historical chunk folders (`docs/chunks/closed/0037-…`, `closed/0041-…`, `closed/0046-…`) and the `log.md` entry that records the migration.
- BoldSign client wrapper has unit-test coverage parity with `src/lib/dropbox-sign/client.test.ts` (env-unset error path, success path, file-fetch path).
- BoldSign webhook-verify module has unit-test coverage parity with `src/lib/dropbox-sign/webhook-verify.test.ts` (HMAC mismatch, missing secret, success).
- BoldSign webhook route handler has integration coverage parity with `src/app/api/dropbox-sign/webhook/route.test.ts` (verified-signed flip, declined flip, replay-idempotent, malformed JSON, bad signature).
- `sendMsaEnvelope` action test (`src/features/msa/actions.test.ts`) exercises the BoldSign send path with the inline-PDF bundle.
- Browser smoke (`web-test`): `goto /dealerships/<id>`; MSA panel renders; "Create MSA" + "Send MSA" controls present (no behavior change from a user POV — the send button still says "Send MSA").

## Resolved decisions

- **D #1 — Schema column name = `provider_document_id`** (decided 2026-05-15). Provider-agnostic rename to future-proof against the *next* swap. Phase 4 ships the rename migration. Audit-payload key follows suit (`signatureRequestId` → `providerDocumentId`).
- **D #2 — BoldSign client = official `boldsign` Node SDK** (decided 2026-05-15). Phase 1 runs `pnpm add boldsign`; Phase 2 wraps the SDK with the same module-cache + `{ ok, ... } | { error }` shape as `src/lib/dropbox-sign/client.ts`. Tests mock the SDK via `vi.mock('boldsign')`. If at Phase 2 the SDK's inline-upload surface turns out to be awkward (e.g. it forces a templates-based flow), pause and revisit — D #2 is contingent on the SDK actually supporting the inline-PDF model the intent requires.
- **D #3 — No in-flight envelope handover needed** (decided 2026-05-15). Dropbox Sign was never used in production — zero envelopes were ever sent. Migration is forward-only and clean: no cutover window, no drain period, no dual-handler era. The audit-log payload key rename (`signatureRequestId` → `providerDocumentId`) is also trivially safe — no historical production rows carry the old key. Phase 1's cutover-preflight task is dropped; Phase 6's Dropbox-Sign deletion happens in the same chunk as the BoldSign cut-in with no gap.
- **D #5 — Sandbox-vs-production URL = `APP_ENV`-derived, no extra env var** (decided 2026-05-15). Mirrors the existing Dropbox Sign convention: `baseUrl = process.env.APP_ENV === 'production' ? 'https://api.boldsign.com' : 'https://api-sandbox.boldsign.com'`. No `BOLDSIGN_API_BASE_URL` env added. Inherits the known `APP_ENV`-normalization fragility flagged in `0041 follow-up (b)` (parked in `CURRENT.md`) — when that follow-up ships its shared env-normalize helper, the BoldSign client adopts it alongside `email/send.ts` and `dropbox-sign/client.ts:83`. SDK wiring confirmed at Phase 1 — `DocumentApi` constructor accepts `basePath?: string` and exposes a `basePath` getter/setter (source: `boldsign-node-sdk/api/documentApi.ts:32-75`); the BoldSign client passes the `APP_ENV`-derived URL to the constructor.
- **D #4 — Webhook signature scheme** (decided 2026-05-15, from BoldSign docs at `https://developers.boldsign.com/webhooks/verify-webhook-events/`). Header: `X-BoldSign-Signature`. Format: `t=<epoch>, s0=<sig>[, s1=<old-key-sig>]` (comma-separated key=value, optional space after comma). Signed payload: `timestamp + "." + rawBody` (Stripe-style). Algorithm: HMAC-SHA256. Encoding: hex. Replay protection: yes — compare `t` against current epoch with a tolerance window (5 minutes per industry convention). Event types: `Signed` (all signers completed) and `Declined` (signer declined). The webhook-verify module shape becomes `verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string, options?: { toleranceSeconds?: number }): { ok: true } | { error }`. The route handler reads the body via `request.text()` BEFORE `JSON.parse` (the body bytes are the signed input; parse-then-reserialize would break the HMAC). Backwards-compat with key rotation: the verifier accepts a match on either `s0` OR `s1` if both are present.

## Open questions

_All chunk-start open questions resolved as of 2026-05-15 — D #1 through D #5 above. Plan execution continues without further preconditions._


## Why now

User-driven provider swap (cost / feature / UX reasons not material to the plan). Dropbox Sign integration shipped recently in `closed/0041-msa-send-bundled-envelope` and `closed/0046-quote-mutable-after-send` and is well-isolated — the migration touches one feature surface, one route handler, one schema column, and one third-party dep. Doing it now (while the integration is fresh + while production MSA volume is low) is cheaper than waiting until many `pending` envelopes are in flight or until the integration surface grows.
