# 0092 — BoldSign sender identity (`onBehalfOf` → Shannon)

## Problem

MSA signature-request emails sent from prod arrive attributed to **David Hogan**
(the BoldSign Account Admin whose API key we use), not to **Shannon Tilley**, the
business signatory whose name + email the MSA prose already carries
(`render-msa.ts:397,406`). The signer sees "David Hogan requested your
signature," which is wrong-looking and off-brand.

Root cause: `sendSignatureRequest` (`src/lib/boldsign/client.ts`) never sets a
sender on the `SendForSign`, so BoldSign attributes every envelope to the user
who owns the API key. The prod Live (CA-region, Enterprise API) account is owned
by `admin@salesability.ca` (David Hogan, Account Admin). Verified live
2026-06-23.

## Desired outcome

Prod MSA envelopes read "**Shannon Tilley (shannon@salesability.ca)** requested
your signature," land in Shannon's BoldSign "sent" view, and send
reminders/notifications from her.

## Approach (chosen 2026-06-23)

BoldSign **Send-on-Behalf-Of**: pass `onBehalfOf: shannon@salesability.ca` on the
`SendForSign`. Shannon is **already an Active Member** of the same prod team
(verified via `GET /v1/users/list`), so this works with **no sender-identity
verification and no role change** — Send-on-Behalf-Of only requires the target to
be a user in the org and the API-key user (David, Admin) to have permission.

Drive it off a new `BOLDSIGN_SENDER_EMAIL` env var (not hardcoded): prod sets it
to `shannon@salesability.ca`; stage/dev leave it unset (different sandbox account
where Shannon isn't a member) → behavior unchanged. Mirrors how
`BOLDSIGN_API_BASE_URL` / `EMAIL_DEV_TO` are env-gated.

## Non-goals

- Transferring BoldSign account ownership / promoting Shannon to Admin (orthogonal
  to the sender fix; can be done separately for account self-management).
- Rotating the API key to a Shannon-owned key (rejected: needless credential
  rotation; `onBehalfOf` is lower-risk).
- Custom BoldSign **Brand** (logo/colors/display name) — separate concern.

## Success criteria

- `sendSignatureRequest` sets `onBehalfOf` when `BOLDSIGN_SENDER_EMAIL` is set,
  omits it when unset. Unit-tested both ways.
- Prod, after setting the env var + redeploy: a Send Test MSA arrives from Shannon.

## Decision record

Rejected alternatives discussed with owner 2026-06-23:
- **Sender Identity create+verify** — unnecessary; that path is for non-members.
  Shannon is already a member, so plain `onBehalfOf` suffices.
- **Make Shannon the Admin / use her API key** — role ≠ sender; the sender is the
  API-key owner. Would require a key rotation + redeploy and lose David's admin
  convenience. Owner chose `onBehalfOf`.
