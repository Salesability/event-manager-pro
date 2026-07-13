# 0103 — Research spike: Canadian A2P sender-number strategy

**Date:** 2026-07-13 (Phase 1)

## Question

Which Twilio sender-number type should campaign SMS sends use for Canadian recipients
(intent open question #4): plain long code, verified toll-free, short code, or a
Messaging Service pool?

## Findings

- **A2P 10DLC does not apply in Canada.** It is a US-carrier registration framework;
  there is no Canadian equivalent registry. Canadian carriers (Rogers, Telus, Bell,
  Fido, Videotron) instead apply content/volume filtering directly.
- **Twilio's own recommendation for A2P into Canada:** "short codes or verified
  toll-free numbers for optimal delivery results"
  ([Canada SMS guidelines](https://www.twilio.com/en-us/guidelines/ca/sms)).
- **Toll-free requires verification, and it's mandatory:** since 2024-01-31 messages
  from *unverified* toll-free numbers are blocked outright; enforcement has tightened
  through 2026. Verification covers US + Canadian networks (Fido, Rogers, Telus,
  Videotron) and takes days-to-weeks, needing a business profile + use-case + sample
  messages + opt-in description
  ([Toll-Free Message Verification](https://help.twilio.com/articles/5377174717595-Toll-Free-Message-Verification-for-US-Canada)).
- **Short codes** are the highest-throughput carrier-sanctioned route but need a
  **Canada-specific short code**, 12–16 weeks provisioning, ~160-char hard limit, and
  materially higher cost — wrong shape for v1 volumes.
- **Plain Canadian long codes** work with no provisioning but carry unmitigated
  carrier-filtering risk for marketing-shaped A2P traffic — the exact class of
  traffic this chunk sends.
- **Anti-patterns:** "snowshoeing" (same content across multiple toll-free numbers)
  is specifically targeted for filtering — one number, not a per-dealer pool.
- **CASL/CRTC floor** (matches intent): opt-in consent per recipient, HELP/STOP
  keyword support, daytime-hours sending, respect do-not-call. STOP/opt-out and
  consent-staleness are Phases 2–4 of this chunk.

## Recommendation

**One Salesability-owned verified toll-free number, attached to a Twilio Messaging
Service.**

- **Toll-free (verified)** — Twilio's recommended v1 route for Canadian A2P; no
  12–16-week short-code runway; throughput (Twilio default ~3 MPS on verified TF) is
  ample for per-campaign lists in the hundreds-to-low-thousands.
- **One number, not per-dealer** — avoids snowshoeing filtering, keeps verification
  to a single owner-driven pass, and matches the business reality (Salesability sends
  on the dealer's behalf; the dealer is named in the message copy).
- **Messaging Service wrapper** — code addresses the `messagingServiceSid`, not the
  raw number, so the sender can later be swapped/upgraded (e.g. to a short code if
  volume justifies it) with zero code change; it also centralizes the status-callback
  URL and gives Twilio-side queueing.
- Twilio's Messaging-Service "Advanced Opt-Out" may be enabled as belt-and-braces,
  but **our own permanent `sms_opt_outs` table stays the compliance floor** (Phase 2/4)
  — the app must be able to prove exclusion independent of vendor state.

## Owner-driven provisioning (flagged, non-blocking)

Runbook entry added to `docs/wiki/go-live-accounts.md`. Owner steps, in order:

1. Create the business-owned Twilio account (same ownership split as Resend/BoldSign).
2. Buy a toll-free number; create a Messaging Service and attach the number.
3. Submit toll-free verification (business profile, use case "event marketing on
   behalf of dealerships", sample messages, opt-in description). **Sends to real
   carriers will filter/block until verification completes** — trial-account sends to
   verified-to-the-account numbers work for stage testing meanwhile.
4. Provision secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_MESSAGING_SERVICE_SID` (sandbox + prod split like BoldSign/Resend).

## Sources

- [Canada: SMS Guidelines | Twilio](https://www.twilio.com/en-us/guidelines/ca/sms)
- [Long codes vs short codes vs toll-free for US/Canada | Twilio Help](https://help.twilio.com/articles/360038173654-What-are-the-differences-between-long-codes-A2P-10DLC-short-codes-and-Toll-Free-numbers-for-messaging-to-US-Canada)
- [Toll-Free Message Verification for US/Canada | Twilio Help](https://help.twilio.com/articles/5377174717595-Toll-Free-Message-Verification-for-US-Canada)
- [Toll-Free SMS best practices (snowshoeing) | Twilio Help](https://help.twilio.com/articles/360038172934-Information-and-best-practices-for-using-Toll-Free-SMS-and-MMS-in-the-US-and-Canada)
