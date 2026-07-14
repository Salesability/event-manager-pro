# SMS Conversation Console — Decisions

**Date:** 2026-07-14 (owner calls via /build kickoff Q&A)

## D1 — AI autonomy: draft-and-approve

AI drafts a suggested reply; a staff member approves/edits/discards before anything sends. Nothing sends without human approval. Autonomous handling (even for narrow non-commercial intents) is deferred — matches the vision's Module 3 workflow and the liability/CASL posture in `intent.md`.

## D2 — Threads are per-campaign; attribution = most-recent-send + manual reassign

A thread is a **(campaign, phone number)** pair — not one global thread per number. Even with a single shared sender, conversations must be tracked per campaign. When an inbound arrives from a number that multiple campaigns have texted, it joins the thread of the campaign that **most recently sent** to that number; staff can **reassign** a mis-attributed thread to the correct campaign from the console.

## D3 — Console lives on the per-campaign panel

Extend the existing `/calendar/[id]/sms` page with a conversations section, gated on the existing `sms:send` capability. No global inbox in v1 (can layer on later).

## D4 — No automation disclosure on approved drafts

Once a staff member approves (possibly edits) an AI draft, it sends as the team's own words — no automated-assistant tag. Disclosure only becomes relevant if autonomous sending is ever enabled later.

## Deferred / defaulted (not owner-blocking)

- **Notification** — in-app surfacing only for v1 (unread indication on the campaign SMS panel); no email notify.
- **AI provider/model** — decided at Phase 4 implementation: Anthropic Claude via the official SDK, env-keyed (`ANTHROPIC_API_KEY`, Secret Manager per-env), per the plan's vendor-client anchor pattern.
- **Opener copy** — shorter reply-inviting default template copy is a campaign-template concern, out of this chunk's scope.
