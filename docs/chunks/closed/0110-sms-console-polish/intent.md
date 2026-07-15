# SMS console polish — names, turn-state, quick replies, funnel strip, sentiment — Intent

**Created:** 2026-07-15

## Problem

Reviewing a competing dealership-SMS product (owner-supplied screenshot, 2026-07-15) ahead of the stage review showed our conversation surfaces are functionally complete but *cold*: threads are labeled by bare phone number, the only state signal is an unread badge, every reply is typed from scratch (or AI-drafted on demand), campaign performance has no at-a-glance funnel, and staff can't tell a hot lead from a tire-kicker without reading every transcript. The competitor shows names, "awaiting a response from you" turn-state, canned quick replies beside their AI suggest button, a Sent/Delivered/Responses/No-Response/Stops stat strip, and per-thread **sentiment dots + hot/cold prospect badges**.

## Desired outcome

- Threads and inbox rows lead with the **customer's name** (falling back to the phone number when unknown), purge-safe — the name is snapshotted onto the thread, not read live through the 24-month-retention recipient row.
- Each thread carries a **turn-state label** — "awaiting your reply" (their message is last) vs "waiting on customer" (ours is last) — derived from the last message's direction; unread stays as-is.
- The reply composer offers a row of **canned quick-reply chips** (tap → fills the box, staff edit/send as usual) beside the existing AI Draft button.
- The per-event Campaign SMS page opens with a **funnel stat strip**: Sent / Delivered / Responses / No response / Stops for that campaign.
- Threads show a **sentiment dot** (green/neutral/red) and a **prospect-temperature badge** (hot/warm/cold) classified from the customer's own messages — *display-only* signals that never gate or trigger anything. Both appear in the console, the inbox, and (aggregate counts) the `/sms` tab.

## Non-goals

- **No autonomy change** — sentiment/temperature are read-only labels; no auto-replies, no queues, no routing. The human-in-the-loop reply flow is untouched.
- **Owner-editable quick-reply templates** — v1 is a curated hardcoded set; an admin editor is a follow-up if the fixed set chafes.
- **Export button** — the competitor has CSV export of the funnel; noted for later, not here.
- **Inbox search/pagination** — that's the parked 0107-a scale pass.
- **Response-rate analytics over time** — the strip is a live snapshot, not a reporting module.

## Success criteria

- A thread whose recipient row holds "Sarah Tester" shows **Sarah Tester** in console + inbox; deleting the recipient row (purge) doesn't blank it.
- A thread whose last message is inbound shows "awaiting your reply"; after staff reply it flips to "waiting on customer".
- Tapping a quick-reply chip fills the reply box verbatim; sending goes through the existing `replyToThread` path unchanged.
- The Campaign SMS page shows the five funnel numbers and they reconcile with the send log + threads + opt-out registry.
- After an inbound lands, the thread (eventually — next classification run) shows a sentiment dot and temperature badge; with `ANTHROPIC_API_KEY` unset, both simply don't render (graceful degradation, like the Draft button).

## Open questions

- **When does classification run?** Leaning: on inbound capture (webhook), best-effort + non-blocking — but that is the app's **first autonomous LLM call** on customer content (0106's AI was strictly human-initiated). PIPEDA posture looks equivalent (same bounded transcript already flows to the human-initiated draft), but the owner should bless the auto-trigger explicitly. Fallback shape if declined: classify lazily on console/inbox load, or on demand.
- Exact chip set for quick replies (start from the competitor's: "What time works for you?", "Terrific — we will see you shortly!", "Sorry we missed you — can we reschedule?", etc.) — Claude drafts ~8, owner can prune in review.
- Does "Responses" in the strip mean threads-with-any-inbound (leaning) or non-STOP inbound only?

## Why now

Owner call 2026-07-15: stage review of the SMS line is imminent; these are the highest-value, lowest-cost items from the competitor review, and names/turn-state/chips materially change how the demo lands. Sentiment + temperature are the "wow" item the owner called out explicitly (the competitor's colored dots + thermometer badges).
