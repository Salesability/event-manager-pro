# 0110 decisions

## D1 — Classification trigger: auto on inbound (owner call 2026-07-15)

**Decision:** the sentiment + prospect-temperature classifier runs **automatically on inbound capture** (webhook, post-commit, best-effort) — the app's first autonomous LLM call on customer content. Owner blessed the auto-trigger explicitly (asked during the 0110 build, 2026-07-15), choosing it over the lazy-on-page-load and on-demand-button fallbacks.

**Posture guards that made it acceptable:**
- **Display-only** — the labels gate nothing, trigger nothing, and route nothing; the human-in-the-loop reply flow is untouched (the shelved autonomy path stays shelved).
- **Same data boundary as the human-initiated draft** — the identical bounded transcript (30 messages × 500 chars) already flows to Anthropic when staff click "Draft AI reply"; PIPEDA posture is equivalent.
- **Best-effort + non-blocking** — a classifier failure (no key, timeout, refusal, malformed output) never fails the webhook; the thread simply stays unclassified. Tight client timeout + no retries so a slow model call can't push the webhook toward Twilio's 15s limit.
- **Closed output contract** — the model can only produce the two enums (Zod-validated); prose or anything else is discarded as an error.

**Eval-cycle addenda (2026-07-15):** classifier client timeout trimmed 8s → 5s (Codex Medium — the capture's own DB round-trips share Twilio's 15s window); a mid-thread STOP now **clears** the thread's AI labels (`captureInboundStop`) so a halted thread never wears a stale "hot prospect" badge — STOP always wins, and the cleared labels also drop out of the `/sms` aggregates.

## D2 — "Responses" in the funnel strip = threads with any inbound

The intent's stated leaning, adopted in Phase 4: a thread whose only inbound is a STOP counts as a response AND as a stop — the strip shows both numbers side by side, which is the honest read of "how many humans reacted".
