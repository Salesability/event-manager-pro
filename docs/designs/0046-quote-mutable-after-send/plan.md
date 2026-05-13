# Make quotes mutable after send + support re-send

**Started:** 2026-05-13
**Status:** Scaffolded — phases not yet started. **Depends on 0043 landing first** (Send history `<Section>`, quote-detail `<KeyValueStrip>`, sticky `<PageHeader>` are anchors for Phase 4–5 work). If 0043 hasn't merged when this chunk is picked up, anchor the page-level edits against the pre-0043 main paths and resolve at merge time.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Server-side guard relaxation (`setQuoteInputs`) + audit `quote.edited` | Done | - |
| 2: `sendQuote` re-send path + `sent_at` reset | Done | - |
| 3: Composer always-editable + "Re-send Quote" button | Done | - |
| 4: `loadQuoteSendHistory` multi-row + Send-history section rewrite | Pending | - |
| 5: Accepted/declined immutability + MSA-bundle re-send gate | Pending | - |
| 6: Wiki (`commercial-spine.md`) + chunk-end smoke + `/eval` | Pending | - |

Simplify the quote lifecycle. Today a quote becomes immutable when its status flips `draft → sent`: `setQuoteInputs` rejects updates via the atomic `WHERE status='draft'` guard, the composer renders a `<fieldset disabled>` with a "this quote is locked" banner, and the Send button only enables on draft. The mental model in the wiki today ("sent quote is the contract artifact") doesn't match user expectations — coaches need to fix pricing typos, swap line items, or re-send to a new contact without an admin DB poke. After this chunk: the *underlying row* stays mutable while `status='sent'`; the composer always shows editable inputs; "Send Quote" becomes "Re-send Quote" once `sentAt` is set, and each send emits a fresh `quote.sent` audit row + re-renders/re-uploads the PDF + re-emails the recipient. The `accepted`/`declined` terminal states stay immutable — those are the *contract* artifacts and should never silently mutate after the deal is locked. Done = (a) save survives any non-terminal status; (b) re-send works from `sent`/`expired`, blocked from `accepted`/`declined` with a clear error; (c) re-send resets `sent_at` to now (and therefore the expiry-window); (d) Send-history Section on `/quotes/[id]` lists every send event (timestamp + recipient + Resend ID + PDF link), most-recent first; (e) wiki updated to retire the "sent is locked" doctrine.

## Decisions locked

- **Status enum unchanged.** `quote.status` stays `draft | sent | accepted | declined` (+ derived `expired`). Status now signals deal-stage only; "can I edit" is decoupled. No migration needed.
- **Re-send fires `quote.sent` again, not a new `quote.resent` action.** Cheaper conceptually (one audit-action grammar), and the audit_log already supports multiple rows per `(target_table, target_id)`. Send-history reads `desc(occurredAt)` and lists them all.
- **PDF storage key overwrite.** Each send re-renders + re-uploads to the same `pdfStorageKey` path; GCS holds the latest. "Old" PDFs live in the recipient's inbox already; the storage key is the staff-portal's current-truth pointer. No versioning suffix.
- **Accepted/declined are immutable.** Server-side `setQuoteInputs` + `sendQuote` reject these statuses with a friendly error ("This quote has been accepted/declined — make a new quote to revise it."). Matches the contract-artifact decision in `commercial-spine.md`. The composer goes back to read-only on terminal statuses only.

## Open Questions

The Phase 1 implementation needs answers before files start moving.

1. **`quote.edited` audit emission shape.** Per-save audit row would be noisy (every keystroke save). Two options: (A) emit only on transitions that change the priced output (subtotal/tax/total/line-items hash changes between pre- and post-update); (B) emit on every successful `setQuoteInputs` regardless. Recommendation: **(A)** — debounced semantic emit, payload includes `before`/`after` hash + dirty fields. Saves auditor effort and avoids polluting Send-history reads.

2. **Re-send expiry reset semantics.** Resetting `sentAt` to now naturally resets the expiry window via the existing derived `isExpired = sentAt + quoteValidDays < now()`. Edge case: re-sending an *expired* quote without explicit acknowledgement. Recommendation: keep behavior implicit — re-send always resets `sentAt`; user's mental model is "I'm sending again, the new deadline applies". Add a confirmation dialog showing "Re-send will reset the validity window — new deadline: YYYY-MM-DD. Continue?" so the reset is opt-in, not silent.

3. **`loadQuoteSendHistory` return shape.** Cardinality flips from `QuoteSendReceipt | null` to `QuoteSendReceipt[]`. Single-row callers (the existing Send-history Section) adapt; tests need rewriting. Recommendation: rename to `loadQuoteSendHistory`, return `QuoteSendReceipt[]` ordered `desc(occurredAt)`, leave the old name as a thin wrapper returning `[0] ?? null` if any caller can't easily migrate. Phase 4 enumerates the consumer audit.

4. **MSA-bundled-envelope re-send interaction.** `sendQuote` participates in the MSA-bundle flow (closed/0041) — first send of a Quote against an MSA-pending dealer bundles the MSA+Quote envelope. Question: should re-sending the Quote re-fire the MSA envelope? Recommendation: **no** — only the first `quote.sent` against a `pending`/no-MSA dealer triggers the envelope; subsequent re-sends emit Resend-only (no envelope). Practical gate: branch in `sendQuote` on `quote.sentAt == null` to decide MSA-bundle vs Resend-only. Plus a sanity gate: if a re-send is attempted *while MSA is `pending` (envelope sent, not yet signed)*, the action returns "MSA envelope is in flight — finish signing or terminate before re-sending the quote" rather than silently bypassing.

5. **Composer expiry-banner copy when editing a sent quote.** Today the composer shows "This quote has been sent and is locked." Post-chunk it should show "Sent on YYYY-MM-DD — re-sending will replace the recipient's copy and reset the validity window to YYYY-MM-DD". Recommendation: ship the new banner in Phase 3 alongside the read-only flag flip. Banner copy lives in `quote-composer.tsx` not in `status-display.ts`.

6. **Concurrent re-send race.** Two staff members hit Re-send at the same time → two PDFs uploaded, two emails sent, two audit rows. The existing atomic UPDATE guard in `sendQuote` covers the audit-row uniqueness via the `WHERE updatedAt = preloaded` predicate — `closed/0041`'s "concurrent-send race" follow-up (a) is the broader version. Recommendation: out of scope for this chunk; document the gap and link to 0041 follow-up (a). Practical mitigation: the second clicker sees a fast Resend toast and a possibly-stale UI; the first clicker's send wins.

7. **Composer dirty-state on already-sent quote.** When a quote is re-opened with `status='sent'` and the coach edits inputs, the diff between the saved row and the in-flight form is real "unsaved changes". The existing `isDirty` indicator works as-is. Recommendation: no change.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `setQuoteInputs` relaxed guard + `quote.edited` emit | `src/features/quotes/actions.ts:270-340` | Same action; edit the existing atomic guarded UPDATE — drop `WHERE status='draft'`, keep the `updatedAt` precondition |
| `sendQuote` re-send path (any status, `sent_at` reset, MSA gate) | `src/features/quotes/actions.ts:641-820` | Same action; extend the existing two-layer guard with a `(sentAt == null ? draft : sent) → sent` transition |
| Accepted/declined immutability assertions | `src/features/quotes/lifecycle.ts:76-140` | `markQuoteAccepted` already carries the two-layer expiry pattern (0044 Phase 1); model the terminal-state-reject the same way |
| Audit emit for `quote.edited` | grep `auditLog.insert` near existing `quote.sent` emit | Same audit helper that `quote.sent` uses; payload shape parallel |
| `loadQuoteSendHistory` multi-row | `src/features/quotes/queries.ts:168-185` | Sibling to `loadQuoteSendReceipt`; same query module; add `.orderBy(desc(auditLog.occurredAt))` per the existing inline note |
| Composer always-editable + Re-send button label | `src/features/quotes/quote-composer.tsx:142-150, 588-602` | Same file; flip `canSend`/`isReadOnly` derivations + label-flip on existing Send button |
| Composer re-send confirm dialog | `src/features/quotes/quote-composer.tsx:679-735` (`ConfirmSendDialog`) | Same file; extend the existing dialog with the new validity-reset copy when `initial.status === 'sent'` |
| Send-history multi-row section | `/quotes/[id]` Send-history Section (post-0043) | Same `<Section variant="card" title="Send history">` shell from 0043 Phase 4; replace the single-row `<dl>` with a list rendering one row per send |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` → quote-as-contract lifecycle. Phase 6 retires the "sent is locked" prose and adds the new "sent stays editable; accepted/declined are the contract" rule.
- `docs/wiki/data-model.md` → `quotes` row + audit_log relationship. Phase 4 documents the multi-row send-history pattern.
- `docs/wiki/layout.md` § Open conventions (post-0043) → the parked composer-actions-lift follow-up is a natural companion to this chunk; either tackle them together or leave the composer-actions-lift parked while this chunk lands first.

**Overall Progress:** 50% (3/6 phases complete)

**Note:**
- Each phase includes implementation + the unit tests for that phase's changes.
- Integration tests + the `/eval` chunk-end smoke live in Phase 6.
- Several existing tests assert the "draft-only edit" behavior — those need updating, not just dropping. Phase 1 lists them in the checklist.

### Phase Checklist

#### Phase 1: Server-side guard relaxation (`setQuoteInputs`) + audit `quote.edited`
- [x] Answer OQ #1 (`quote.edited` emission policy — recommended A: semantic emit on priced-output change)
- [x] Drop `WHERE status='draft'` from `setQuoteInputs`'s atomic UPDATE in `actions.ts`; switch to `updatedAt` optimistic-lock precondition + `status NOT IN ('accepted','declined')` (Phase 1 added the lock-by-`updatedAt` shape the plan assumed was already there — see `sendQuote`'s `date_trunc('ms', …)` pattern reused here)
- [x] Add terminal-status reject: `if (current.status === 'accepted' || current.status === 'declined') return { error: 'This quote has been <status> — make a new quote to revise it.' }`
- [x] Emit `quote.edited` audit row when the pre/post priced-output hash differs; payload `{ before: { subtotal, tax, total, lineItemsHash }, after: { … }, dirtyFields: string[] }`
- [x] Add the `quote.edited` value to the `audit_action` pgEnum (schema + migration `0020_quote_edited_audit.sql` + `0020_snapshot.json` mirroring the `msa.*` precedent in `0019`)
- [x] Update existing test cases in `actions.test.ts` that assert draft-only edit behavior — flip them to assert "sent edits succeed; accepted/declined edits fail with the new error message"
- [x] New test: edit of an `expired` (derived `isExpired=true`) quote succeeds (expired is a presentation, not a guard)
- [x] New test: `quote.edited` audit row emitted on priced-output change; not emitted on a save that doesn't change the priced output
- [x] `tsc + test` gate

#### Phase 2: `sendQuote` re-send path + `sent_at` reset
- [x] Drop the `status='draft'` precondition in `sendQuote`; pre-load now reads `sentAt` so Phase 5 can branch first-send vs re-send for the MSA-bundle gate (Phase 2 itself is branch-free — same code path serves both)
- [x] Terminal-status reject mirroring Phase 1 (accepted/declined refused with friendly error)
- [x] Re-render PDF + re-upload to existing `pdfStorageKey` (overwrite)
- [x] Update `sent_at` to `new Date()` on every successful send (resets expiry window)
- [x] Emit fresh `quote.sent` audit row on every send (multi-row accumulation OK)
- [x] Atomic UPDATE guard adapted: instead of `WHERE status='draft'`, use `WHERE updatedAt = preloaded` + `status NOT IN ('accepted', 'declined')` to keep the optimistic-lock + terminal-block invariant
- [x] New tests: first-send happy path (unchanged), re-send happy path (status stays `sent`, sentAt advances, audit row added, PDF re-uploaded), re-send from `expired` works, re-send from `accepted` rejected, re-send from `declined` rejected
- [x] New test: `sendQuote` is still idempotent on the "send-then-immediate-retry-with-same-updatedAt" path (the existing test) — the optimistic-lock keeps re-running the same send safe
- [x] `tsc + test` gate

#### Phase 3: Composer always-editable + "Re-send Quote" button
- [x] Flip `isReadOnly = isEdit && initial.status !== 'draft'` → `isReadOnly = isEdit && (initial.status === 'accepted' || initial.status === 'declined')` (composer fields editable on `sent`/`expired`; only terminal statuses lock)
- [x] Flip `canSend = isEdit && initial.status === 'draft'` → `canSend = isEdit && initial.status !== 'accepted' && initial.status !== 'declined'`
- [x] Send-button label: "Save Draft" / "Save Quote" stays on draft/non-sent edits; "Send Quote" on first-send (`initial.sentAt == null`); "Re-send Quote" on subsequent (`initial.sentAt != null`)
- [x] Replace "locked" banner with the new copy — absolute "Sent on YYYY-MM-DD" used instead of relative time so SSR/CSR hydration doesn't drift at bucket boundaries (notable departure from plan; documented in the inline comment on `formatSentRelative`)
- [x] `ConfirmSendDialog` gains a re-send variant: title "Re-send this quote?" + body "The recipient will receive a new PDF; the validity window resets to YYYY-MM-DD." (computed from now + `quoteValidDays`)
- [x] Drop the `<fieldset disabled>` wrapper for `sent`/`expired` status; keep it for `accepted`/`declined` — handled by the new `isReadOnly` derivation; the fieldset's `disabled={isReadOnly}` now naturally lets `sent` through
- [x] Page-level prop wiring: `/quotes/[id]` page passes `sentAt` + `quoteValidDays` into the composer's `initial` prop
- [x] `tsc + test` gate (composer has no test file today — the composer's behavior is exercised via actions.test.ts + the chunk-end web-test smoke)

#### Phase 4: `loadQuoteSendHistory` multi-row + Send-history section rewrite
- [ ] Answer OQ #3 (rename to `loadQuoteSendHistory` returning `QuoteSendReceipt[]`)
- [ ] Rename `loadQuoteSendReceipt` → `loadQuoteSendHistory`; return `QuoteSendReceipt[]`; add `.orderBy(desc(auditLog.occurredAt))`; update the inline comment that anticipated this
- [ ] Update `src/features/quotes/queries.test.ts` `loadQuoteSendReceipt` block — rename + assert multi-row ordering (insert 3 audit rows for the same quote, expect 3-element array, descending)
- [ ] `/quotes/[id]/page.tsx`: replace the single-row `<dl>` Send-history rendering (post-0043 `<Section variant="card" title="Send history">`) with a list rendering one row per send. Each row: `<RelativeTime value={sentAt}>` + Sent-to recipient + Resend ID (font-mono) + Download PDF link (only on the most-recent row, since `pdfStorageKey` overwrites)
- [ ] Drop the "(recipient unknown — sent before recipient denorm shipped)" branch if `sentToEmail` denorm is now always present (audit) — keep the fallback if any pre-denorm rows exist in prod
- [ ] `tsc + test` gate

#### Phase 5: Accepted/declined immutability + MSA-bundle re-send gate
- [ ] Confirm Phase 1 + 2 terminal-status rejects fire correctly (cross-phase regression check)
- [ ] Wire OQ #4: in `sendQuote`, before the MSA-bundle branch (closed/0041), gate `if (quote.sentAt != null) { /* skip MSA bundle, plain Resend send only */ }`
- [ ] Plus the "MSA-pending in-flight" sanity: if MSA exists and `msa.status === 'pending'` and `msa.dropboxSignDocumentId != null` (envelope sent, not yet signed), refuse re-send with "MSA envelope is in flight — finish signing or terminate before re-sending this quote"
- [ ] Composer: re-send button disabled with title-tooltip when the MSA-pending-in-flight condition holds (UI parity with server-side reject — same `closed/0044` pattern: server is the gate, UI is the courtesy)
- [ ] New tests: first send still bundles MSA when no MSA exists; re-send of an already-sent quote against an MSA-pending dealer does NOT re-fire the envelope; re-send blocked when MSA envelope is in flight
- [ ] `tsc + test` gate

#### Phase 6: Wiki (`commercial-spine.md`) + chunk-end smoke + `/eval`
- [ ] Update `docs/wiki/commercial-spine.md` — the "sent quote = contract artifact" prose retires; replaces with "*accepted* quote is the contract; sent quotes stay editable to support late corrections + re-sends, with the recipient's copy resetting on each Re-send". Cross-link `docs/wiki/data-model.md` audit_log multi-row pattern.
- [ ] Update `docs/wiki/data-model.md` — `quotes` walkthrough mentions the multi-`quote.sent` audit pattern; the "one quote.sent row per quote" note from 0026 retires.
- [ ] Append `docs/wiki/log.md` entry covering all the above + the doctrine flip
- [ ] Full `pnpm test` run — all existing tests pass after the flipped assertions in Phase 1+2
- [ ] `web-test` smoke battery (driveable):
  - `goto /quotes/<draft-quote-id>` — heading `Quote #X draft`, composer editable, button `Save Draft` + (no Send) — confirm draft path unchanged
  - `goto /quotes/<sent-quote-id>` — heading `Quote #X sent`, composer editable, banner reads "Sent <relative>. Editing here updates the staff record; clicking Re-send Quote replaces the recipient's copy", buttons `Preview PDF` + `Save Quote` + `Re-send Quote`
  - click `Re-send Quote` — `ConfirmSendDialog` opens with title "Re-send this quote?" and copy mentioning the validity-window reset (do NOT click confirm — destructive)
  - `goto /quotes/<accepted-quote-id>` — composer fields disabled, banner reads "This quote has been accepted — make a new quote to revise it.", no Save/Send buttons (read-only branch still fires for terminal statuses)
  - Send history section on `/quotes/<re-sent-quote-id>` (a quote with ≥2 sends seeded via the smoke fixture below) — renders 2 rows, most-recent first, each with relative time + recipient + Resend ID
- [ ] If no re-sent fixture exists in dev DB: throwaway fixture script `scripts/0046-resent-quote-smoke.ts` with `insert` (creates a quote + emits 2 `quote.sent` audit rows + flips status) / `cleanup` (deletes by tag) subcommands. Pattern: `scripts/calendar-clamp-smoke.ts`.
- [ ] Full `/eval` at chunk-end
