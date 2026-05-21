# Dropbox Sign → BoldSign migration — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-05-15
**Feature branch:** `0051-dropbox-sign-to-boldsign`

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: BoldSign SDK install + env wiring | Done | `682b1c2` |
| 2: `src/lib/boldsign/` client + webhook-verify modules | Done | `287a17d` |
| 3: `/api/boldsign/webhook` route handler | Done | `b4baee8` |
| 4: Schema rename — `dropbox_sign_document_id` → `provider_document_id` (D #1) | Done | `ba29aeb` |
| 5: Switch `sendMsaEnvelope` + lifecycle helpers over to BoldSign | Done | `25e7562` |
| 6: Remove Dropbox Sign code, route, dep, env vars | Done | `0ad23d4` |
| 7: Wiki + smoke verification | Done | (docs/ gitignored — no commit) |

The migration mirrors today's Dropbox Sign shape onto BoldSign — same inline-upload bundle (MSA PDF + first-Quote PDF), same single-signer envelope, same lifecycle (`pending → active | terminated`), same atomic guarded UPDATE. The chunk is **done** when (a) `sendMsaEnvelope` posts to BoldSign, (b) a BoldSign-signed webhook flips the MSA row to `active` with the signed PDF archived to GCS at `msa/<msaId>/signed.pdf`, and (c) `grep -rin "dropbox" src/ docs/wiki/ .env.example` returns nothing outside historical chunk folders.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/boldsign/client.ts` | `src/lib/dropbox-sign/client.ts:1-129` | Same role (server-only provider wrapper), same `{ ok, ... } \| { error }` discriminated-union return shape, same `__resetForTests` module-cache hatch, same `sendSignatureRequest` + `getSignedFileBytes` surface |
| `src/lib/boldsign/client.test.ts` | `src/lib/dropbox-sign/client.test.ts:1-82` | Mirror env-unset / success / file-fetch coverage shape |
| `src/lib/boldsign/webhook-verify.ts` | `src/lib/dropbox-sign/webhook-verify.ts:1-45` | Same `VerifyResult = { ok: true } \| { error }`; `crypto.timingSafeEqual` constant-time compare; same length-mismatch fast-path. Signing scheme differs (`X-BoldSign-Signature` over raw body) — OQ #4 |
| `src/lib/boldsign/webhook-verify.test.ts` | `src/lib/dropbox-sign/webhook-verify.test.ts:1-81` | Mirror HMAC-mismatch / missing-secret / success coverage |
| `src/app/api/boldsign/webhook/route.ts` | `src/app/api/dropbox-sign/webhook/route.ts:1-228` | Same external-caller pattern; same HMAC-verify-before-mutation gate; same `parseJsonField` / `handleSigned` / `handleDeclined` decomposition; same idempotent-replay short-circuit on `status === 'active'` |
| `src/app/api/boldsign/webhook/route.test.ts` | `src/app/api/dropbox-sign/webhook/route.test.ts:1-212` | Mirror signed-flip / declined-flip / replay / malformed-json / bad-sig coverage |
| Schema rename in `src/lib/db/schema/master-service-agreements.ts:23` | self (the existing `dropboxSignDocumentId` column declaration) | Rename only — keep type (`text`, nullable), keep ordering; the Drizzle migration is `ALTER TABLE … RENAME COLUMN …`. Sweep all referrers |
| `sendMsaEnvelope` body in `src/features/msa/actions.ts:188-379` | self (the current Dropbox-Sign path) | Same action shape; swap `sendSignatureRequest` import source from `@/lib/dropbox-sign/client` → `@/lib/boldsign/client`; rename `dropboxSignDocumentId` → `providerDocumentId`; same atomic guarded UPDATE pattern |
| `markMsaSigned` / `markMsaDeclined` in `src/features/msa/lifecycle.ts` | self (lines 38-145) | Same atomic-guarded-UPDATE shape; parameter rename `dropboxSignDocumentId` → `providerDocumentId`; audit payload key renamed accordingly |

**Conventions referenced:**
- `docs/wiki/architecture.md` — external-caller webhook route handlers are the exception to "Mutations go through Server Actions"; the gate is HMAC verification before any read/mutation.
- `docs/wiki/commercial-spine.md` — MSA lifecycle states + the inline-bundle "MSA + first Quote" envelope shape are load-bearing for the customer-facing flow.
- `docs/wiki/data-model.md` — `master_service_agreements` column inventory must stay accurate post-rename.
- CLAUDE.md → "Mutations go through Server Actions" — the webhook route handler is the documented exception (external caller, no `auth.users` session, HMAC-gated).
- `db-conventions` skill — column rename migration, audit-log column nullability, Drizzle-vs-Supabase migration recipe (invoke before writing the migration).

**Overall Progress:** 100% (7/7 phases complete) — chunk-end `/eval` pending

**Note:**
- Phases 1 → 3 are additive (new module + new route alongside the existing one) — no behavior change yet.
- Phase 4 schema rename + Phase 5 send-path swap are the cutover; they ship as one commit pair so production never sees a half-renamed column.
- Phase 6 is the cleanup; Phase 7 is wiki + smoke verification.
- OQ #3 (in-flight envelope handover) must be checked in Phase 1 — if any `pending` MSAs have a Dropbox Sign document id, decide cutover strategy before proceeding.

### Phase Checklist

#### Phase 1: BoldSign SDK install + env wiring
- [x] `pnpm add boldsign` (D #2 — official Node SDK). **Installed `boldsign@3.1.4`** (published 2026-05-08). SDK audit confirmed: `DocumentApi.sendDocument(sendForSign)` accepts inline file uploads (`files: [...]` on `SendForSign`); `DocumentApi.downloadDocument()` fetches the completed PDF; `DocumentApi` constructor accepts `basePath?: string` and exposes a `basePath` getter/setter at `api/documentApi.ts:32-75` (D #5 implementable).
- [x] Confirm webhook signature scheme from BoldSign docs — resolved as **D #4** in `intent.md`: `X-BoldSign-Signature: t=<epoch>, s0=<sig>[, s1=<old-sig>]`; signed payload = `timestamp + "." + rawBody`; HMAC-SHA256 hex; replay-protection timestamp included; event types `Signed` / `Declined`.
- [x] ~~Confirm sandbox-vs-production URL strategy~~ — resolved per D #5 (`APP_ENV`-derived, no extra env var). Phase 2's `client.ts` does `new DocumentApi(process.env.APP_ENV === 'production' ? 'https://api.boldsign.com' : 'https://api-sandbox.boldsign.com')`.
- [x] ~~Cutover preflight~~ — dropped per D #3 (Dropbox Sign never used in production; no in-flight envelopes to reconcile).
- [x] `.env.example` rewritten — pre-existing stubs at the old lines 60-63 folded into a proper comment block matching the Dropbox Sign block's shape: API key role, webhook secret signing-input shape (HMAC-SHA256 over `t + "." + body`), and the `APP_ENV`-derived sandbox-vs-prod note. **`BOLDSIGN_API_BASE_URL` not added** per D #5.

#### Phase 2: `src/lib/boldsign/` client + webhook-verify modules
- [x] `src/lib/boldsign/client.ts` — `client()` returning `{ ok, documentApi } | { error }`; module-cache singleton; `DocumentApi` constructed with `APP_ENV`-derived `basePath` per D #5; `setApiKey()` from `BOLDSIGN_API_KEY` env.
- [x] `sendSignatureRequest(input)` — `SendSignatureRequestInput` matches today's Dropbox Sign shape (`subject`, `message`, `signer: {emailAddress, name}`, `files: [{filename, body}]`, `metadata`); calls `DocumentApi.sendDocument(SendForSign)` with inline-upload files; returns `{ ok: true; documentId: string } | { error }`. Sets `isSandbox` belt-and-suspenders alongside the basePath.
- [x] `getSignedFileBytes(documentId)` — wraps `DocumentApi.downloadDocument(documentId)`; returns `{ ok: true; body: Buffer } | { error }`.
- [x] `src/lib/boldsign/client.test.ts` — 14 cases: env-unset, sandbox URL default, production URL when `APP_ENV=production`, singleton caching; send success / error / no-documentId / sandbox flag / metadata pinning; download success / non-Buffer / error.
- [x] `src/lib/boldsign/webhook-verify.ts` — `verifyWebhookSignature(rawBody, signatureHeader, secret, options?)` per D #4: parses `t=<ts>, s0=<sig>[, s1=<sig>]` header, computes HMAC-SHA256 hex over `timestamp + "." + body`, accepts s0-or-s1 match, replay-window check against `nowSeconds` (default 300s tolerance), constant-time compare.
- [x] `src/lib/boldsign/webhook-verify.test.ts` — 14 cases: s0 match, s1 (rotated key) match, no-space header format, secret-mismatch, body tampering, replay window, custom tolerance, non-numeric timestamp, missing header, missing secret, malformed (no `t=`), malformed (no `s0`/`s1`), length-mismatch short-circuit.
- [ ] ~~Drop `src/lib/dropbox-sign/templates.ts`~~ — **deferred to Phase 6** (cleanup phase). `currentMsaTemplateVersion()` is provider-agnostic; relocating it to `src/features/msa/template-version.ts` is cleanest done in the same commit as the dropbox-sign module deletion. Phase 2 stays strictly additive.

#### Phase 3: `/api/boldsign/webhook` route handler
- [x] `src/app/api/boldsign/webhook/route.ts` — `POST(request)` handler reads `x-boldsign-signature` header, calls `request.text()` for raw body, runs `verifyWebhookSignature(rawBody, header, secret)` BEFORE `JSON.parse` (parse-then-reserialize would break the HMAC).
- [x] Parse BoldSign event payload — `{ event: { eventType: 'Signed' | 'Declined' | ..., id, created, environment }, data: { documentId } }`. Event types `Signed` and `Declined` (capitalized) per D #4 are the lifecycle drivers; other types (e.g. `SenderIdentityUpdated`) ack 200 without dispatching.
- [x] `handleSigned(documentId, bucket)` — looks up MSA by `dropboxSignDocumentId` (will be renamed to `providerDocumentId` in Phase 4's sweep); short-circuits `status === 'active'` (replay), refuses `expired`/`terminated`, fetches signed PDF, uploads to GCS at `msa/<msaId>/signed.pdf`, flips via `markMsaSigned`. Note: matches the `lifecycle.markMsaSigned` signature today (Phase 5 renames the param).
- [x] `handleDeclined(documentId)` — calls `markMsaDeclined`; idempotent on already-terminated rows; 404 for unknown documentId per the test.
- [x] Acknowledgement body — plain `OK` with HTTP 200; no provider-specific ack string.
- [x] `src/app/api/boldsign/webhook/route.test.ts` — 12 cases: bad-signature 401, missing-secret 500, missing-header 401, malformed-JSON 400, Signed-flip new row, Signed unknown doc id 404, Signed replay (already-active) 200 no-op, Declined-flip 200, Declined unknown doc id 404, unrelated event type 200 no-op, missing documentId 400, BoldSign file fetch 502.

#### Phase 4: Schema rename — `dropbox_sign_document_id` → `provider_document_id` (D #1)
- [ ] Invoke `db-conventions` skill first. Then edit `src/lib/db/schema/master-service-agreements.ts:23` — rename TS property `dropboxSignDocumentId` → `providerDocumentId`, rename DB column `dropbox_sign_document_id` → `provider_document_id`. Keep `text` + nullable. Decision is locked to provider-agnostic per D #1 — do not fall back to `boldsign_document_id` even if Drizzle codegen is awkward.
- [ ] Generate migration: `pnpm drizzle-kit generate` (or the project's equivalent — confirm via `db-conventions`).
- [ ] Inspect generated SQL — should be `ALTER TABLE master_service_agreements RENAME COLUMN dropbox_sign_document_id TO provider_document_id`. Hand-edit if Drizzle generates a drop-and-add.
- [ ] Sweep all referrers: `rg -l "dropboxSignDocumentId|dropbox_sign_document_id" src/` — update each file to the new name. Expected hits: `src/features/msa/actions.ts:33,211,219,346,354,358`, `src/features/msa/lifecycle.ts:55,72,84,99,106,118,123,134`, `src/features/msa/lifecycle.test.ts`, `src/features/msa/actions.test.ts`, plus any audit-payload string keys (`payload: { signatureRequestId: ... }`).
- [ ] Rename audit payload key — `payload.signatureRequestId` → `payload.providerDocumentId` (or keep `signatureRequestId` historical — decide whether the audit log "vocabulary" follows provider language or stays provider-agnostic; lean: provider-agnostic since the audit log is forever).
- [ ] `pnpm tsc --noEmit` clean.

#### Phase 5: Switch `sendMsaEnvelope` + lifecycle helpers over to BoldSign
- [ ] `src/features/msa/actions.ts:14` — swap `import { sendSignatureRequest } from '@/lib/dropbox-sign/client'` → `from '@/lib/boldsign/client'`.
- [ ] `src/features/msa/actions.ts:15` — drop the `dropbox-sign/templates` import; replace with the relocated `template-version` helper from Phase 2.
- [ ] `src/features/msa/actions.ts:325-339` — adapt `sendSignatureRequest` call site for BoldSign return-shape (`signatureRequestId` → `documentId`).
- [ ] `src/features/msa/lifecycle.ts:8` top-of-file comment — update reference from "Dropbox Sign webhook" to "BoldSign webhook"; update path `/api/dropbox-sign/webhook` → `/api/boldsign/webhook`.
- [ ] Lifecycle helper parameter names: `dropboxSignDocumentId` → `providerDocumentId` throughout `lifecycle.ts` + tests.
- [ ] `src/features/msa/actions.test.ts` — swap mocked module from `@/lib/dropbox-sign/client` → `@/lib/boldsign/client`; update `signatureRequestId` field references → `documentId`.
- [ ] `src/features/msa/lifecycle.test.ts` — rename parameter usage + audit payload assertions.
- [ ] `pnpm test` green.

#### Phase 6: Remove Dropbox Sign code, route, dep, env vars
- [ ] Delete `src/lib/dropbox-sign/` (all 6 files: `client.ts`, `client.test.ts`, `webhook-verify.ts`, `webhook-verify.test.ts`, `templates.ts`, `index.ts` if any).
- [ ] Delete `src/app/api/dropbox-sign/webhook/` (both `route.ts` and `route.test.ts`).
- [ ] `pnpm remove @dropbox/sign`.
- [ ] Remove `DROPBOX_SIGN_API_KEY` / `DROPBOX_SIGN_CLIENT_ID` / `DROPBOX_SIGN_WEBHOOK_SECRET` from `.env.example` + the explanatory comment block at `.env.example:46-58`.
- [ ] Sweep references: `rg -rin "dropbox" src/ .env.example` should be zero. `rg -rin "dropbox" docs/wiki/` should also be zero (handled in Phase 7).
- [ ] `pnpm tsc --noEmit` clean; `pnpm test` green; `pnpm lint` zero errors.

#### Phase 7: Wiki + smoke verification
- [x] `docs/wiki/architecture.md` — sweep complete: new dedicated E-signature row added to the stack table (BoldSign / DocumentApi / inline-upload / APP_ENV basePath / X-BoldSign-Signature HMAC-SHA256); "Future integrations" trimmed; Server-Action/route-handler example updated; "Send-time MSA gate" + "Migration roadmap" + "out of scope" sections updated.
- [x] `docs/wiki/commercial-spine.md` — happy-path ASCII diagram + spine entity-table MSA row updated to BoldSign / `providerDocumentId`. Lifecycle (`pending → active | terminated`) and "inline MSA prose, no provider-side template" language unchanged.
- [x] `docs/wiki/data-model.md` — `master_service_agreements` column list updated to `provider_document_id`; dedicated section comments swapped to BoldSign with a note that the column was renamed in 0051 Phase 4; MSA-pending in-flight gate paragraph swapped to `provider_document_id`.
- [x] `docs/wiki/log.md` — 2026-05-15 entry prepended summarizing the 7-phase migration + the D-records + the audit-payload-key rename safety (no prod rows carried the old key).
- [ ] Smoke (web-test): `inject-supabase`; `goto /dealerships/<id>`; expect MSA panel heading + "Create MSA" button visible. **Delegated to chunk-end `/eval`.**
- [ ] Smoke (web-test): MSA-create dialog renders with the BoldSign-flavored body text. **Delegated to chunk-end `/eval`.**
- [x] (Manual — gated on Phase 1 sandbox creds) Live BoldSign sandbox round-trip: **Deferred → 0041 follow-up (e)** (already parked in `CURRENT.md`). Sandbox creds were not wired in this chunk.
- [x] Final verification: `rg -rin "dropbox" src/ docs/wiki/ .env.example` returns only intentional matches — the new 2026-05-15 log entry, historical log entries (CLAUDE.md → don't rewrite history), the data-model column-rename note, and legacy `HELLOSIGN_API_KEY` compromised-credential references in `architecture.md`. Zero references in `src/` or `.env.example`.
