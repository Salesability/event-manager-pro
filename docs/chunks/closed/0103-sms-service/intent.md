# SMS Service (Twilio + campaign-driven texts) — Intent

**Created:** 2026-07-09

## Problem

The app has no SMS capability. The vision ([`docs/strategy/vision.md`](../../../strategy/vision.md), Module 2 "Event Production Console") makes SMS a marketing channel campaigns can activate — texts sent to a dealership's customer list to drive event attendance, as an **add-on service the dealer buys for a given event**, not something every campaign uses. Today there is no SMS provider integration, no way to compose a campaign-driven text message, no recipient-list handling, and no delivery tracking; campaigns only carry an `sms_email` *count* (a delivery metric derived from the accepted quote), not an actual send capability.

Sending also has a compliance problem that email doesn't force as hard: the dealer's contact list is only lawfully textable under CASL consent, and **implied consent goes stale** — if the dealer has had no contact/transaction with a person within the consent window, that opt-in has lapsed. Without the service tracking opt-outs and consent recency, any SMS send we run on a dealer's behalf risks texting people the dealer no longer has the right to text.

## Desired outcome

- A **Twilio-backed SMS service** wired into the app the same way other vendors are (dedicated client lib, secrets in Secret Manager, env-keyed sandbox/prod behavior, a dev-redirect guard analogous to `EMAIL_DEV_TO` so stage can never text real customers).
- **SMS as a per-campaign add-on, not a universal channel.** Not every campaign texts — SMS is an add-on service the dealer buys into for a given event. The SMS surface (compose/launch) only lights up on campaigns where the add-on is active. (Note: the accepted quote already fans delivery counts into `campaigns.sms_email` — a nonzero count may be the natural "this campaign bought SMS" signal; see open questions.)
- **Campaign-driven text messaging**: for a booked campaign (event) with the SMS add-on, staff can compose an SMS whose payload is derived from campaign data (dealership name, event dates/format, offer) with personalization variables (e.g. `{{first_name}}`), attach a recipient list, review, and launch the send.
- **Delivery tracking**: per-message status (queued → sent → delivered/failed) recorded via Twilio status callbacks, with a per-campaign send summary.
- **Compliance floor**, two rules that must never be violated once we start sending (full three-layer DataLoader compliance is *not* this chunk):
  - **Opt-out (STOP)** recorded permanently and enforced on every subsequent send.
  - **Consent staleness**: a dealer's contact-list opt-in goes stale if the dealer has had no contact/transaction with the person within a window — CASL implied consent lapses (≈2 years from a purchase/contract, 6 months from an inquiry). Each recipient carries a consent basis + last-contact date; the pre-send summary excludes (and reports) recipients whose window has lapsed.

## Non-goals

- **DataLoader (Module 1)** — multi-source upload, AI scrubbing/cleaning, channel segmentation, DNCL registry integration. This chunk needs *a* recipient list per campaign (e.g. CSV upload of pre-cleaned numbers), not the full data pipeline.
- **Two-way SMS console / AI response engine** (vision Module 3) — inbound conversation threads, AI-suggested replies. Inbound handling here is limited to STOP/opt-out capture.
- **Other channels** — email-blast campaigns, landing pages, letters, print fulfillment.
- **Campaign scheduling calendar** — multi-channel release scheduling (SMS Day 1, Email Day 2 …). v1 sends are launch-now (or a single scheduled send at most, if it falls out cheaply).
- **AI creative generation** — staff write/edit the message copy by hand in v1; template variables yes, AI drafting no.

## Success criteria

- Twilio credentials live in Secret Manager (sandbox + prod keys separated like BoldSign/Resend); no key material in the repo.
- The SMS compose/launch surface appears only on campaigns with the SMS add-on active; a campaign without it shows nothing SMS-related.
- From an eligible event/campaign detail surface, staff can compose an SMS (with variables), upload/select a recipient list, see a pre-send summary (count, opt-outs excluded, stale-consent recipients excluded with the reason visible), and launch.
- Messages actually deliver on a Twilio trial/sandbox number in stage with the dev-redirect guard active; per-message status lands back via the status-callback webhook and is queryable per campaign.
- A recipient who replies STOP is recorded and excluded from every later send, provably (integration test).
- A recipient whose consent window has lapsed (last-contact date older than the window for their consent basis) is excluded from the send, provably (unit/integration test on the eligibility predicate).
- Unit + integration tests green; browser smoke covers the compose/review surface read-only.

## Open questions

- **What flips the add-on on** — is "campaign has SMS" derived from the accepted quote's line items (nonzero `campaigns.sms_email`, zero new schema), an explicit toggle/flag on the campaign, or its own quotable SKU? Derived-from-quote is cheapest but couples the messaging surface to the commercial spine; an explicit flag is more honest if SMS can be sold/added after quote-accept.
- **Recipient source of truth** — CSV upload per campaign (a per-campaign `sms_recipients` table), or first-class contact records? The vision's DataLoader buckets don't exist yet; v1 likely = per-campaign upload with a permanent global opt-out table keyed by phone number.
- **Consent-staleness mechanics** — what fields must the uploaded list carry to evaluate staleness (consent basis: purchase vs inquiry vs express; last-contact/transaction date)? Are the windows fixed to CASL's defaults (2yr purchase / 6mo inquiry, express = no expiry) or configurable? Does *our* send on the dealer's behalf count as "contact" that refreshes the window (almost certainly not — the underlying business relationship is dealer↔customer), and do we warrant this per-dealer via the MSA (vision Layer 3 says dealer warrants consent)?
- **Sender number strategy** — one Salesability-owned number, a number per dealer/campaign, or a Twilio Messaging Service pool? Canadian A2P rules (10DLC doesn't apply in Canada, but CRTC/carrier filtering does) may push toward a registered short code or toll-free verified number — needs a small research spike.
- **Volume/throughput** — expected list size per campaign (hundreds vs tens of thousands) decides whether a simple loop with Twilio's Messaging Service queue is enough, or we need our own batching/queue (Cloud Tasks?). Cloud Run request timeouts matter here.
- **Who may launch** — role gate (`campaign:edit`? admin-only?) and whether launch needs the staged Draft → Review → Approved flow from the vision or a simple confirm dialog in v1.
- **Twilio account ownership** — business-owned Twilio account needs provisioning (go-live-accounts runbook entry), same who-does-what split as Resend/BoldSign.

## Why now

The scheduling/commercial spine (calendar → quote → MSA → e-sig) has shipped; the roadmap's next frontier is the production console, and SMS is its highest-leverage channel. The owner asked for the SMS implementation chunk explicitly (2026-07-09).
