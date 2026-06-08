# Send Test MSA (admin BoldSign verification tool) — Intent

**Created:** 2026-06-08

## Problem

Production BoldSign has only been exercised **once** end-to-end (the 0055 live smoke on Cloud Run). There's no on-demand way for an admin to verify the prod BoldSign integration is healthy — prod-tier API key, the `api-ca.boldsign.com` regional host, `isSandbox=false`, inline PDF upload, signature-field placement, envelope creation — without manufacturing a real `master_service_agreements` row tied to a real dealer + quote bundle and walking the full `sendMsaEnvelope` flow.

After any config change that could break BoldSign in prod — API-key rotation, region/host change, an `MSA_TEMPLATE_VERSION` bump, or just a prod redeploy — there is no quick "does BoldSign still send in prod?" button. Chunk **0064 (Send Test Email)** solved exactly this for Resend deliverability; this is the BoldSign analogue, with the same shape (admin-only action + Zod schema + form + page + nav).

## Desired outcome

A standalone admin **`/admin/send-test-msa`** page: a minimal form (recipient email + signer name + optional custom message) gated by `msa:edit`, calling a thin Server Action that:
1. Renders the MSA PDF with **placeholder/sample data** via the existing `renderMsaPdf()` (no DB row, no quote bundle).
2. Posts a real BoldSign envelope through the existing `sendSignatureRequest()` path.
3. Surfaces the returned **BoldSign `documentId`** (proof of send) — or the error — in the UI.

In production (`APP_ENV=production`) this sends a **real** (`isSandbox=false`) envelope to the typed recipient — which is exactly the prod path being verified. It reuses the same prod/dev gate `sendSignatureRequest` already owns (non-prod → sandbox + `EMAIL_DEV_TO` redirect, refusing if unset).

## Non-goals

- **Full signed round-trip automation** (signing → webhook → signed-PDF persist). The tool verifies the **send**; completing the signature is a manual step from the BoldSign email. (The webhook behavior for a no-MSA-row test envelope is an open question below.)
- **Creating/persisting a real MSA or quote.** Throwaway and DB-free — it must not write `master_service_agreements`, `quotes`, or `quote_line_items`.
- **Bulk / multi-recipient sends** (single typed address, mirroring 0064).
- **Replacing the real send flow.** `sendMsaEnvelope` remains the production path for real agreements; this is a sibling verification tool only.

## Success criteria

- [ ] An admin loads `/admin/send-test-msa`, types their own email + a signer name, submits, and the page reports the BoldSign `documentId` (or a clear error).
- [ ] In prod, the recipient receives a real BoldSign signing email; the envelope shows up in the BoldSign dashboard.
- [ ] **No** `master_service_agreements` row (or any quote row) is created by the test.
- [ ] Page + action are gated (`msa:edit`, admin-only, under `/admin`); a matrix row exists in `action-gate-matrix.ts`.
- [ ] Reuses `renderMsaPdf` + `sendSignatureRequest` — **no** new BoldSign client code, no bypass of the `isSandbox`/dev-redirect gate.
- [ ] Full test suite green; the no-MSA-row webhook behavior (open question 2) is resolved one way or the other.

## Open questions

_All resolved 2026-06-08 (owner: "build and deploy to prod" + the original "exercise BoldSign **in production**" intent)._

1. ~~`isSandbox` in prod (real send)~~ — **Resolved → real send.** In prod, `sendSignatureRequest` sets `isSandbox=false` → a real, binding-style envelope + real signing email + consumes prod BoldSign quota. That IS the intent ("exercise production BoldSign"). Recipient = the admin's own controlled address. The tool does not force sandbox in prod.
2. ~~Signed-envelope webhook noise~~ — **Resolved → option (b), webhook guard.** The test send stamps `metaData: { test: 'true' }`; `/api/boldsign/webhook` short-circuits to `200 OK` when the **verified** payload's `metaData.test === 'true'`, BEFORE the `providerDocumentId` lookup — so a signed test envelope (no MSA row) doesn't 404-retry. Safe because only this test tool sets `test:true` (real envelopes carry `msaId`); the guard sits after signature verification.
3. ~~Capability / gate~~ — **Resolved → admin-only via `admin:access`.** ⚠️ *Corrected during build:* `msa:edit` admits **admin OR coach** (`capabilities.ts:83`) — gating on it would leak this real-prod-envelope tool to coaches. The tool is admin-only (intent), the page lives under `/admin/*` (middleware admin-gated), and the sibling 0064 is admin-only (`email:send`). So gate the page (`assertCan('admin:access')`) AND the action (`capabilityClient('admin:access')`) on the pure-admin `admin:access` capability. No new capability.
4. ~~Document content~~ — **Resolved → MSA-only, placeholder data.** Render the real MSA template (`renderMsaPdf`) with placeholder data (clientName "TEST — BoldSign smoke", today's term dates, signer = typed name/email), **MSA-only** (no bundled quote — the MSA `signatureAnchor` is the one required form field). The smoke's job is the BoldSign API path, not the Quote+MSA bundle.

## Why now

0066 just shipped to prod, where BoldSign runs production-tier (`api-ca.boldsign.com`, `isSandbox=false`). Prod BoldSign has only been exercised once (0055). A repeatable admin verification tool de-risks every future prod change — key rotation, template bump, redeploy — the same rationale that motivated 0064 for email. Cheap, self-contained, and reuses the existing render + send primitives.
