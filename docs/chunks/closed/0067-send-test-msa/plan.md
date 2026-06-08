# Send Test MSA (admin BoldSign verification tool) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + Server Action (+ webhook test-guard) | Done | `7377653` |
| 2: Compose form component | Done | `85ebd48` |
| 3: Admin page + nav entry | Done | `61d4eab` |
| 4: Tests + smoke verification | Done | `1b78eab` |

A standalone admin **Send Test MSA** page: a minimal form (Recipient email / Signer name / optional Message) gated by `msa:edit` that calls a thin Server Action over the existing `renderMsaPdf()` + `sendSignatureRequest()` primitives. Its job is **BoldSign verification** — prove the system posts a real envelope to a chosen address in prod (prod-tier key, `api-ca` host, `isSandbox=false`, field placement, PDF upload) and surface the BoldSign `documentId` (or the error) in the UI. "Done" = an admin can load the page, send themselves a test MSA, see the document id, and (if OQ2→option b) a signed test envelope no longer 404s the webhook — with **no** new MSA/quote row, **no** new capability, and **no** bypass of the `isSandbox`/dev-redirect gate. Mirrors chunk **0064 (Send Test Email)** for BoldSign instead of Resend.

> **✅ Open questions resolved 2026-06-08** (see [intent.md](intent.md)): OQ1 → real `isSandbox=false` prod send (recipient = admin's own address); OQ2 → webhook `metaData.test` guard (option b); OQ3 → **admin-only via `admin:access`** (⚠️ corrected from `msa:edit`, which admits coaches too — see intent OQ3); OQ4 → MSA-only render with placeholder data. Phases below execute these answers directly.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `sendTestMsa` action in `src/features/msa/actions.ts` (new export) | `src/features/msa/actions.ts:154` (`sendMsaEnvelope`) + `src/features/email/actions.ts:71` (`sendTestEmail`) | The MSA module's BoldSign send shape (`renderMsaPdf` → `sendSignatureRequest`, surface `documentId`), composed in the thin "test tool" shape of `sendTestEmail` (typed recipient, `capabilityClient(...).schema(formDataSchema)`, surfaces provider id, no DB write) |
| `src/features/msa/test-msa-schema.ts` (new Zod object schema) | `src/features/email/test-email-schema.ts` | Same shared-schema idiom (client `zodResolver` + server `safeParse(Object.fromEntries(formData))`); single-recipient email regex `.refine()`, CRLF guards |
| `src/features/msa/send-test-msa-form.tsx` (new client form) | `src/features/email/send-test-email-form.tsx` | Same `useTransition` + `react-hook-form`/`zodResolver` + `toLegacyResult` + `toast.success/error` + surface-provider-id banner idiom |
| `src/app/(app)/admin/send-test-msa/page.tsx` (new admin page) | `src/app/(app)/admin/send-test-email/page.tsx` | Same async server shell + `await assertCan(...)` at top + `<PageHeader>` + render client form |
| `ADMIN_TABS` entry in `src/components/app/app-nav.tsx` | the `send-test-email` `ADMIN_TABS` row (`app-nav.tsx`) | A new admin page = one more `{ href, label }` entry (implicitly admin-gated by the `isAdmin` dropdown guard) |
| matrix row in `src/features/__tests__/action-gate-matrix.ts` | the existing `sendTestEmail` row + the `msa:edit` rows | Drift-detection test requires every gated action to have a matrix row |
| *(OQ2 option b)* test-metadata guard in `src/app/api/boldsign/webhook/route.ts` | `route.ts:82` (the missing-MSA **404** branch) | Short-circuit to `200 OK` when the BoldSign payload's `metaData.test === 'true'`, BEFORE the `providerDocumentId` lookup — so a signed test envelope (no MSA row) doesn't trigger 404 retries |

**Conventions referenced:**
- CLAUDE.md → *Conventions*: "Mutations go through Server Actions, not route handlers" — this send is triggered by our own UI, so it's a Server Action.
- `src/lib/auth/capabilities.ts:39` — `msa:edit` is admin-scoped; gate the page with `assertCan('msa:edit')` and the action with `capabilityClient('msa:edit')`. **No new capability.**
- `src/lib/boldsign/client.ts:136` (`sendSignatureRequest`) — reuse as-is; it already owns `isSandbox = APP_ENV !== 'production'` AND the non-prod dev-redirect (refuses if `EMAIL_DEV_TO` unset, else rewrites the recipient). The tool must **not** bypass this. Requires ≥1 form field — the MSA `signatureAnchor` supplies it.
- `src/lib/pdf/render-msa.ts` (`renderMsaPdf`, `MsaPdfData`) — render the MSA PDF + `signatureAnchor` with placeholder data; no quote bundle (`combineQuoteAndMsa` not needed for the smoke).
- `src/features/msa/template-version.ts` — `MSA_TEMPLATE_VERSION` feeds `MsaPdfData.templateVersion` (same as the real flow).
- `src/lib/actions/legacy-result.ts` (`toLegacyResult`) + `src/lib/actions/action-client.ts` (`formDataSchema`) — the action-client + result-adapter idiom every form uses.

**Overall Progress:** 100% (4/4 phases complete) — chunk-end `/eval` PASS-with-warnings ([`eval-2026-06-08-0917.md`](eval-2026-06-08-0917.md)); Codex Medium (APP_ENV `isSandbox` normalization) fixed in-cycle at `2c9a011`.

**Note:**
- Each phase includes both implementation and tests.
- Phase 4 verification is a **read-only** browser smoke — it must NOT click Send (in prod that's a real BoldSign envelope + real signing email, against web-test discipline). The live send is a manual one-off the admin runs (mirrors 0064 Phase 4).

### Phase Checklist

#### Phase 1: Schema + Server Action (+ webhook test-guard)
- [ ] Add `testMsaFormSchema` (Zod object) in `src/features/msa/test-msa-schema.ts`: `to` = regex `.refine()` single-email (copy `test-email-schema.ts`'s pattern + the `,`/`;`/whitespace exclusion), `signerName` = non-empty trimmed string, `message` = optional trimmed string. Export an inferred type for the form.
- [ ] Add `sendTestMsa` to `src/features/msa/actions.ts`: `capabilityClient('msa:edit').schema(formDataSchema).action(...)`; `safeParse(Object.fromEntries(formData))` → first-field-error on failure; build `MsaPdfData` with placeholder data (clientName "TEST — BoldSign smoke", `signerName`/`to` from the form, `termStart=today`, `termEnd=+12mo`, `templateVersion` from `MSA_TEMPLATE_VERSION`); `renderMsaPdf(...)`; then `sendSignatureRequest({ subject, message, signer: { emailAddress: to, name: signerName }, files: [{ filename, body }], signatureAnchor, metadata: { test: 'true' } })`.
- [ ] Return shape surfaces the BoldSign id on success — `{ ok: true; documentId: string } | { error: string }` (mirror `TestEmailResult`). **No** DB write (no `master_service_agreements`/quotes/GCS).
- [ ] Register `sendTestMsa` in the action-gate matrix (`ADMIN_ONLY`/`msa:edit`).
- [ ] **(OQ2 → option b)** In `src/app/api/boldsign/webhook/route.ts`, short-circuit to `200 OK` when the verified payload's `metaData.test === 'true'`, before the MSA lookup — so a signed test envelope doesn't 404-retry. Add a route test for it.
- [ ] Unit test: valid input → `renderMsaPdf` + `sendSignatureRequest` called with mapped args, returns the documentId; invalid email / empty signer name → `{ error }`; render failure + send failure surfaced. (Per-role denial covered by the matrix row.)

#### Phase 2: Compose form component
- [ ] `src/features/msa/send-test-msa-form.tsx` (`'use client'`): `useForm({ resolver: zodResolver(testMsaFormSchema), mode: 'onTouched' })` + `useTransition`.
- [ ] Fields: Recipient email (`<Input type="email">`), Signer name (`<Input>`), Message (catalyst `<Textarea>`, optional), each with `<FieldError>`.
- [ ] `onSubmit` builds `FormData`, calls `sendTestMsa`, wraps with `toLegacyResult`; on success show an inline "Sent ✓ — BoldSign document id" banner + `toast.success`; on failure `toast.error(result.error)`. Send button shows a `pending` ("Sending…") state.
- [ ] Validation pinned at the schema layer in `test-msa-schema.test.ts` (the contract `zodResolver` + the action's `safeParse` both use) — repo has no jsdom/RTL for component render tests (see 0064 Phase 2 note).

#### Phase 3: Admin page + nav entry
- [ ] `src/app/(app)/admin/send-test-msa/page.tsx`: async server component, `await assertCan('msa:edit')` at top, `<PageHeader title="Send Test MSA" description="Post a one-off test BoldSign envelope to any address to verify production e-sign.">`, render `<SendTestMsaForm />`.
- [ ] Add `{ href: '/admin/send-test-msa', label: 'Send Test MSA' }` to `ADMIN_TABS` in `src/components/app/app-nav.tsx`.
- [ ] Confirm the route is admin-gated — two layers: middleware `ADMIN_PATHS` prefix-matches `/admin/send-test-msa`, plus page-level `assertCan('msa:edit')`; nav entry sits inside the `isAdmin`-only dropdown.

#### Phase 4: Tests + smoke verification
- [x] Action unit tests green (Phase 1, `actions.test.ts` — 7 `sendTestMsa` cases) + schema rejects bad email / multi-recipient / empty signer name / CRLF / over-length message (`test-msa-schema.test.ts`) + webhook test-guard test (`route.test.ts`). Full suite **963 passing**, tsc clean.
- [x] Ingested into `docs/wiki/`: `commercial-spine.md` (send-path verification + `metaData.test` guard) and `go-live-accounts.md` (BoldSign runbook — how to verify prod). Added a `log.md` entry.
- [x] Smoke (web-test, **read-only**): `/admin/send-test-msa` shows heading "Send Test MSA" + `Recipient` / `Signer name` / `Message (optional)` + `Send`; Admin nav dropdown lists "Send Test MSA". **PASS** (chunk-end `/eval` 2026-06-08-0917; did not submit).
- [x] Smoke (web-test): unauth `/admin/send-test-msa` → `/login?next=%2Fadmin%2Fsend-test-msa`. **PASS**.
- [ ] **Manual one-off (prod):** after deploy, drive the real form (admin auth) → recipient = admin's own email; confirm BoldSign returns a `documentId`, the email arrives, and the envelope shows in the BoldSign dashboard. **This is a real prod send** — use a controlled address.
