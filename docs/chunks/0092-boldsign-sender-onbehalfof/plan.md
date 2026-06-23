# 0092 — BoldSign sender `onBehalfOf` — plan

Started: 2026-06-23

Derived from [`intent.md`](./intent.md). Make prod MSA envelopes come *from
Shannon* by setting `SendForSign.onBehalfOf`, driven by a new
`BOLDSIGN_SENDER_EMAIL` env var. Shannon is already an Active Member of the prod
BoldSign team, so no sender-identity verification / role change is needed.

## Code Anchors

- `src/lib/boldsign/client.ts` — `sendSignatureRequest()`; build of `SendForSign`
  (sets `title`/`message`/`isSandbox`/`signers`/`files`/`metaData`). Add
  `onBehalfOf` here.
- `src/lib/boldsign/client.test.ts` — `describe('sendSignatureRequest')`. Add
  set/omit cases.
- `deploy.sh` — optional-env passthrough block (~270-285, next to
  `BOLDSIGN_API_BASE_URL` / `EMAIL_DEV_TO`).
- `.env.example` — BoldSign block (~50-85).
- `docs/wiki/go-live-accounts.md` §3 BoldSign — account-owner + sender fact.
- `docs/wiki/log.md` — ingest entry.

## Phases

### Phase 1 — code + env wiring · Status: Done
- [x] In `sendSignatureRequest`, read `process.env.BOLDSIGN_SENDER_EMAIL?.trim()`
      and set `sendForSign.onBehalfOf` when non-empty; omit when unset.
- [x] Add `BOLDSIGN_SENDER_EMAIL` passthrough to `deploy.sh` (optional, only when
      set locally — same shape as `EMAIL_DEV_TO`).
- [x] Document `BOLDSIGN_SENDER_EMAIL` in `.env.example`.

### Phase 2 — tests + docs · Status: Done
- [x] Unit tests: `onBehalfOf` set when env present; omitted when unset.
- [x] Ingest into `go-live-accounts.md` (owner = admin@salesability.ca; Shannon
      Active Member; `BOLDSIGN_SENDER_EMAIL=shannon@salesability.ca` in prod) +
      `log.md`.
- [x] `tsc + test` green for the boldsign suite.

### Phase 3 — prod cutover · Status: Done (deploy) / owner-verify pending
- [x] Set `BOLDSIGN_SENDER_EMAIL=shannon@salesability.ca` on prod + redeploy.
      **✅ Deployed 2026-06-23** — added the var to `.env.production.local`
      (durable; deploy.sh uses `--set-env-vars`, so it must be sourced each
      deploy), ran `DEPLOY_CONFIRM=production ./deploy.sh` → rev
      **`event-manager-pro-00034-5pp`** (image `:20260623-222123`, us-east4).
      Verified on the live revision: `BOLDSIGN_SENDER_EMAIL=shannon@salesability.ca`
      + `APP_ENV=production`; domain `/`→307, `/login`→200.
- [ ] **Owner-verify:** sign in to `eventpro.salesability.ca` as admin →
      **Send Test MSA** (`/admin/send-test-msa`) to your own email → confirm the
      BoldSign request now arrives **from Shannon Tilley**, not David.

## Progress Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — code + env wiring | Done | env-gated `onBehalfOf`; inert when unset |
| 2 — tests + docs | Done | 2 new unit tests; wiki + log ingested |
| 3 — prod cutover | Done (deploy) | rev `-00034-5pp`; env var live; Send Test MSA owner-verify pending |

## Chunk-end gate

Phases 1–2 shipped the inert code; Phase 3 deployed it to prod with the env var
live (rev `-00034-5pp`). Only remaining: the owner's Send Test MSA visual
confirmation that the request now reads "from Shannon Tilley." Close the chunk
once confirmed.
