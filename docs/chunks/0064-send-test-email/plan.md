# Send Test Email (admin deliverability tool) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-04

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + Server Action | Done | 95957ff |
| 2: Compose form component | Done | 5f1f2d0 |
| 3: Admin page + nav entry | Done | 30dbdce |
| 4: Tests + smoke verification | Pending | - |

A standalone admin **Send Test Email** page: a free-compose form (To / Subject / Body) gated by `email:send` that calls a thin Server Action over the existing `sendEmail()` helper. Its job is **deliverability verification** — prove the system sends a real email to a chosen address and surface the Resend message id (or the error) in the UI. "Done" = an admin can load the page, send themselves a message, see it arrive, and the page reports the outcome — with no new schema, no new capability, and no bypass of the non-prod dev-redirect gate.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `sendTestEmail` action in `src/features/email/actions.ts` | `src/features/email/actions.ts:54` (`sendClientCampaignConfirmation`) | Same module, same `capabilityClient('email:send').schema(formDataSchema)` + `senderEmailOrError` + `sendEmail()` shape |
| `src/features/email/test-email-schema.ts` (new Zod object schema) | `src/features/dealers/dealer-schema.ts` | Object-based form schema shared client-side (`zodResolver`) + server-side (`safeParse(Object.fromEntries(formData))`) |
| `src/features/email/send-test-email-form.tsx` (new client compose form) | `src/features/dealers/dealer-form.tsx:83` | `useTransition` + `react-hook-form`/`zodResolver` + `toLegacyResult` + `toast.success/error` idiom; multi-text-input form |
| `src/app/(app)/admin/send-test-email/page.tsx` (new admin page) | `src/app/(app)/admin/lookups/page.tsx:8` | async server shell + `await assertCan(...)` at top + `<PageHeader>` + render client form |
| `ADMIN_TABS` entry in `src/components/app/app-nav.tsx:37` | existing `ADMIN_TABS` rows (`app-nav.tsx:37-40`) | A new admin page = one more `{ href, label }` entry in the array (implicitly admin-gated by the `isAdmin` dropdown guard) |
| matrix row in `src/features/__tests__/action-gate-matrix.ts` (Phase 1, added) | the existing "Email send" rows (`ADMIN_ONLY`) | Drift-detection test requires every gated action to have a matrix row |

**Conventions referenced:**
- CLAUDE.md → *Conventions*: "Mutations go through Server Actions, not route handlers" — this send is triggered by our own UI, so it's a Server Action (not a route handler).
- `src/lib/auth/capabilities.ts:41,117` — `email:send` is admin-only; gate the page with `assertCan('email:send')` and the action with `capabilityClient('email:send')`. No new capability.
- `src/lib/email/send.ts` — reuse `sendEmail({ to, subject, text, replyTo })`; it already owns the prod/dev split (non-prod rewrites recipient to `EMAIL_DEV_TO` + `[DEV→…]` subject prefix). The tool must not bypass this.
- `src/lib/actions/legacy-result.ts` (`toLegacyResult`) + `src/lib/actions/action-client.ts:65` (`formDataSchema`) — the action-client + result-adapter idiom every form uses.

**Overall Progress:** 75% (3/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Phase 4 verification is a **read-only** browser smoke — it must NOT click Send (that's a real Resend send, against web-test discipline). Sending end-to-end is a manual one-off the admin runs.

### Phase Checklist

#### Phase 1: Schema + Server Action
- [x] Add `testEmailFormSchema` (Zod object) in `src/features/email/test-email-schema.ts`: `to` = regex-`.refine()` email (matches `dealer-schema.ts` idiom, not `z.email()`), `subject` = non-empty trimmed string, `body` = non-empty trimmed string. Export an inferred type for the form.
- [x] Add `sendTestEmail` to `src/features/email/actions.ts`: `capabilityClient('email:send').schema(formDataSchema).action(...)`; `safeParse(Object.fromEntries(formData))` → first-field-error on failure (added a local `firstFieldError`); `senderEmailOrError(ctx.user)` for `replyTo`; call `sendEmail({ to, subject, text: body, replyTo })`.
- [x] Return shape carries the message id on success — `{ ok: true; id: string } | { error: string }` (`TestEmailResult`, declared alongside the existing `ActionResult`).
- [x] Register `sendTestEmail` in the action-gate matrix (`ADMIN_ONLY`) — the drift-detection test fails on any unregistered gated action.
- [x] Unit test: valid input → `sendEmail` called with mapped `{ to, subject, text, replyTo }`, returns the id; invalid email / empty subject / empty body → `{ error }`; send-helper failure surfaced. (Per-role denial covered by the action-gate matrix row.)

#### Phase 2: Compose form component
- [x] `src/features/email/send-test-email-form.tsx` (`'use client'`): `useForm({ resolver: zodResolver(testEmailFormSchema), mode: 'onTouched' })` + `useTransition`.
- [x] Fields: To (`<Input type="email">`), Subject (`<Input>`), Body (catalyst `<Textarea>`), each with `<FieldError>`.
- [x] `onSubmit` builds `FormData`, calls `sendTestEmail`, wraps with `toLegacyResult`; on success `setSentId(id)` + `toast.success` (and an inline "Sent ✓ — message id" banner); on failure `toast.error(result.error)`. Send button shows `pending` state ("Sending…").
- [x] ~~Test: render the form + assert validation blocks submit~~ — **not feasible**: repo runs vitest in `node` env with no jsdom/RTL (component tests here only cover hook-free presentational components called as plain functions). Validation is instead pinned at the schema layer in `test-email-schema.test.ts` (the contract `zodResolver` + the action's `safeParse` both use) — covers valid+trim, bad email, whitespace subject, empty body.

#### Phase 3: Admin page + nav entry
- [x] `src/app/(app)/admin/send-test-email/page.tsx`: async server component, `await assertCan('email:send')` at top, `<PageHeader title="Send Test Email" description="Send a one-off plain-text email to any address to verify deliverability.">`, render `<SendTestEmailForm />`.
- [x] Add `{ href: '/admin/send-test-email', label: 'Send Test Email' }` to `ADMIN_TABS` in `src/components/app/app-nav.tsx`.
- [x] Confirm the route is admin-gated — **two layers**: middleware `ADMIN_PATHS = ['/admin', …]` prefix-matches `/admin/send-test-email` (`src/lib/supabase/middleware.ts:14,21`), plus page-level `assertCan('email:send')`. Nav entry sits inside the `isAdmin`-only dropdown.

#### Phase 4: Tests + smoke verification
- [ ] Action unit tests green (Phase 1) + schema rejects bad email / empty subject / empty body.
- [ ] Smoke (web-test, **read-only**): `goto /admin/send-test-email`; expect heading "Send Test Email" + fields `To` / `Subject` / `Body` + a `Send` button. Do **not** click Send.
- [ ] Smoke (web-test): a non-admin / unauth session does not reach `/admin/send-test-email` (redirect/deny).
- [ ] Manual one-off (out of the automated gate): admin sends to their own address, confirms inbox receipt + the message id shows in the UI. Record the result in the chunk close-out.
