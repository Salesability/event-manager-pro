# Send Test Email (admin deliverability tool) — Intent

**Created:** 2026-06-04

## Problem

There is no way inside the app to send an ad-hoc email to an arbitrary address. Every existing "Email …" affordance is *contextual* — a templated message sent to a recipient already on file (Email Client / Email Coach on the calendar event detail, the quote/MSA send flows). When the question is simply *"does email delivery actually work end-to-end right now?"* — correct from-address, the right `RESEND_API_KEY` / `RESEND_FROM_EMAIL` wired, the message lands in a real inbox — there is no in-app affordance. Today you'd have to trigger a real customer-facing send or run code by hand.

## Desired outcome

An admin opens a dedicated admin page, types a recipient address, a subject, and a plain-text body, clicks **Send**, and the app sends a real email through the existing `sendEmail()` path (`src/lib/email/send.ts`). The page reports the outcome — success **with the Resend message id**, or the error string — so the admin can confirm deliverability (right from-address, secret present, inbox receipt) without touching any customer-facing flow. A reader can tell we got there by loading the page, sending themselves a message, and seeing it arrive.

## Non-goals

- **No rich/HTML composer** — plain-text body only (maps to `sendEmail`'s `text` field; `html` stays optional and unused here).
- **No templates, mail-merge, recipient-on-file, or contact picker** — the recipient is a free-typed address.
- **No new capability** — reuses the existing admin-only `email:send`.
- **No attachments, CC/BCC, scheduling, or persisted send history / audit log.**
- **Not wired into any customer/coach communication flow** — this is an internal diagnostic tool.
- **No bulk / multi-recipient send.**

## Success criteria

- A new admin route renders a compose form with **To / Subject / Body** fields and a **Send** button, reachable from the admin nav (admins only).
- Submitting calls a `capabilityClient('email:send')` Server Action that validates input with a Zod object schema and calls `sendEmail({ to, subject, text, replyTo })`.
- On success the UI surfaces confirmation **including the Resend message id**; on failure it surfaces the error string.
- In a non-production environment the dev-redirect behavior of `sendEmail` still applies (recipient rewritten to `EMAIL_DEV_TO`, `[DEV→…]` subject prefix) — the tool does **not** bypass the production gate.
- Non-admins cannot reach the route or the action.

## Open questions

- **Success surface:** show the raw Resend message id (leaning yes — it's a diagnostic tool), not just a generic "sent" toast. *(Tentative: yes.)*
- **Persistence:** should each test send write a lightweight log row so repeated tests are auditable? *(Default: no — a non-goal; revisit only if this graduates into a real outreach feature.)*
- **Nav placement:** its own top-level `ADMIN_TABS` entry ("Send Test Email") vs nesting under an existing admin page. *(Default: its own entry.)*

## Why now

The app is mid go-live — the prod GCP project (`eventpro-498313`) and prod Resend / from-address (`eventpro@salesability.ca`) have not been exercised end-to-end. A one-click in-app send to a chosen address is the cheapest way to confirm the production email path *before* any customer-facing email goes out.
