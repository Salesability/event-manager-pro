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

### Phase 3 — prod cutover · Status: ❌ REVERTED (onBehalfOf breaks the webhook)
- [x] Deployed `BOLDSIGN_SENDER_EMAIL` (rev `-00034-5pp`) — envelope DID come from
      Shannon, but the test send exposed a **critical regression**.
- [x] **Root cause (live-verified):** `onBehalfOf` transfers document ownership to
      Shannon and **403-locks the app's API key (David's) out of the doc** —
      `download` + `properties` return `403 Forbidden`; the doc is absent from the
      key's `list`/`teamlist`/`behalfList` (a normal doc 200s with the same key).
      The webhook downloads the signed PDF with that key (`route.ts:101`
      `getSignedFileBytes`) **before** flipping the MSA `active`, so the 403 →
      webhook 502 → **MSA never activates, signed PDF never archived.**
- [x] **Rolled back 2026-06-23** — `gcloud run services update --remove-env-vars`
      → rev **`event-manager-pro-00035-c8h`**; also removed the var from
      `.env.production.local` (so the next `./deploy.sh` can't re-add it). Verified:
      var absent from the service + the file; domain `/`→307, `/login`→200. Prod is
      back to working (sends as David, downloads succeed, MSAs activate).

### Phase 4 — the CORRECT fix (Shannon-owned API key) · Status: Deployed 2026-06-24 (owner-verify pending)
- [x] Promote Shannon to Admin in BoldSign (so she can generate an API key). — done 2026-06-24.
- [x] Shannon generates a **Live** API key under her user. — done 2026-06-24 (owner).
- [x] **Shannon's key staged as `boldsign-api-key` v4** (2026-06-24, enabled, now
      `:latest`). v3 = David's key stays enabled as the rollback. ⚠️ **Correction:** the
      service mounts `boldsign-api-key:latest` (the revision spec stores `:latest`, NOT a
      pinned number) — so staging v4 did **not** safely hold prod on v3; any cold-started
      instance after v4 became `:latest` would resolve v4. A true hold needs an explicit
      `:N` pin or disabling the newer version. The 0093 deploy (`-00037`, 15:09, after v4
      at 15:04) had almost certainly already been serving v4 on cold starts.
- [x] **Prod redeploy — DONE 2026-06-24** via `GCP_REGION=us-east4
      DEPLOY_CONFIRM=production ./deploy.sh` → rev **`event-manager-pro-00038-w2z`**
      (image `:20260624-194431`, us-east4), serving 100%. Mounts `boldsign-api-key:latest`
      (v4) with `BOLDSIGN_SENDER_EMAIL` **unset** (confirmed absent on the revision).
      Domain smoke healthy (`/`→307, `/login`→200, `/calendar`+`/quotes/new`→307).
      Rollback = `gcloud secrets versions disable 4 --project=eventpro-498313` (v3 becomes
      latest again) → redeploy.
- [ ] **Verify (owner action):** Send Test MSA → confirm envelope is **from Shannon**
      AND a real sign → webhook `download` returns 200 → MSA flips `active`.
      ⚠️ **The in-flight Summerside Hyundai MSA is STILL `pending`/unsigned** with an
      envelope out (sent under David's v3 key, checked prod 2026-06-24). If the dealer
      signs it now (prod on Shannon's v4 key), Shannon's key may **403** on the webhook
      download → MSA won't auto-activate, PDF won't archive (the same ownership 403 that
      killed `onBehalfOf` in Phase 3). Options: void + re-send under Shannon's key, or
      accept that one envelope may need a manual archive.

## Progress Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — code + env wiring | Done | env-gated `onBehalfOf`; inert when unset |
| 2 — tests + docs | Done | 2 new unit tests; wiki + log ingested |
| 3 — prod cutover | ❌ Reverted | `onBehalfOf` 403-locks the app key out of the doc → webhook can't download the signed PDF → MSA won't activate. Rolled back to rev `-00035-c8h`. |
| 4 — Shannon-owned API key | Deployed 2026-06-24 | Shannon promoted + Live key (`boldsign-api-key` v4). **Prod redeployed → rev `-00038-w2z`** (mounts v4 via `:latest`, `BOLDSIGN_SENDER_EMAIL` unset, smoke healthy). Remaining: owner Send-Test-MSA verify (from-Shannon + webhook download 200). ⚠️ Summerside Hyundai MSA still `pending`/unsigned (David-key envelope) — at 403 risk if signed now. |

## Chunk-end gate

The `onBehalfOf` approach (Phases 1–3) is a **dead end** — it severs the app's
API access to the document, breaking the signed-MSA webhook. Code is left in
place but inert (env var unset). The chunk's goal ("envelopes from Shannon")
moves to **Phase 4: swap the prod app to a Shannon-owned BoldSign API key.**
Don't close until Phase 4 ships (or the goal is explicitly dropped).
