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

### Phase 3 — prod cutover · Status: Blocked (owner action)
- [ ] Set `BOLDSIGN_SENDER_EMAIL=shannon@salesability.ca` on prod + redeploy
      (`GCP_REGION=us-east4 DEPLOY_CONFIRM=production ./deploy.sh`) — **only on
      explicit go**.
- [ ] Verify via Send Test MSA → envelope arrives from Shannon Tilley.

## Progress Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — code + env wiring | Done | env-gated `onBehalfOf`; inert when unset |
| 2 — tests + docs | Done | 2 new unit tests; wiki + log ingested |
| 3 — prod cutover | Blocked | owner sets env var + redeploys, then Send Test MSA |

## Chunk-end gate

Phases 1–2 ship the inert code (safe — no behavior change until the prod env var
is set). Phase 3 is a deploy-time owner action, intentionally left open.
