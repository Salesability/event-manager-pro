# Pipeline panel — commitment-first redesign — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _scaffolded 2026-06-22; not started. Follow-up to 0087 (closed) reshaping the rep
Pipeline panel only. UI + small server affordance; **no migration** (reuses `dealer_activities` +
`logDealerActivity`)._

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — save model, Done-kind default, escape hatch, byproduct-logging | Done | - |
| 2: Server — "complete next action" path (reuse/extend `logDealerActivity`) | Done | - |
| 3: Panel reshape — next-action hero + Done flow + compact metadata row | Done | - |
| 4: Tests + smoke | Pending | - |

Make the **next action** the hero; turn logging into a byproduct of completing a commitment
("Done" → record a touch + advance the promise). Remove the duplicate next-action field + the
standalone 5-field log form. Keep `dealer_activities` writes so the 0088 dashboard's counts survive.

## Code Anchors

| New / changed code | Anchor (`path:line`) | Why this anchor |
|--------------------|----------------------|-----------------|
| Reshaped panel (next-action hero, Done flow, compact Stage/Priority/Owner row, recent list) | `src/features/dealers/dealer-pipeline-panel.tsx` (the current panel — RHF + `Field`/`Input`/`Textarea` + `Button` + `toLegacyResult` patterns to reuse) | It IS the file being reshaped; keep its form/transition idioms |
| "Complete next action" server path (record touch + advance + stamp `last_contacted_at`) | `src/features/schedule/actions.ts` (`logDealerActivity` — already inserts a `dealer_activities` row, stamps `last_contacted_at`, and optionally sets the next action in the same call; `setDealerPipeline` for the patch shape) | The building block exists; "Done" is a thin caller/variant, not new infra |
| Badges / labels reused | `src/components/app/status-badge.tsx` (`PipelineStageBadge`/`PriorityBadge`) + `src/features/dealers/pipeline.ts` (`ACTIVITY_KINDS`/labels) | Already built in 0087 |
| Recent-activity read | `src/features/schedule/queries.ts` (`loadDealerActivities`) | Unchanged; the recent list stays |
| Gate-matrix | `docs/wiki/auth.md` + `src/features/__tests__/action-gate-matrix.ts` | Only if a NEW exported gated action is added (a Done variant); reusing `logDealerActivity` needs no new row |
| Wiki | `docs/wiki/data-model.md` (the dealer pipeline / `dealer_activities` prose — note the byproduct-logging flow) | State-of-system ingest |

**Conventions referenced:** `docs/wiki/data-model.md` (pipeline + `dealer_activities`), `docs/wiki/layout.md` (panel/Button primitives), `docs/wiki/auth.md` (only if a new gated action lands). **No `db-conventions`** — no schema change expected.

**Overall Progress:** 75% (3/4 phases complete)

**Notes:**
- **No migration.** If Phase 1 unexpectedly wants a new column (e.g. a `next_action_completed_at`), revisit — but the lean design reuses what 0087 shipped.
- Prefer **reusing `logDealerActivity`** for "Done" (it already does insert + stamp + optional next-action) over adding a new exported action — that avoids a new gate-matrix row. Only add a dedicated action if Phase 1 finds the reuse awkward.
- Supersedes the 0087 panel UX; 0087 stays in `closed/`. The `/dealerships` queue (0087 Phase 5) is untouched.

### Phase Checklist

#### Phase 1: Decision gate
- [x] **Save model** — auto-save next-action on blur vs explicit Save. Lean: explicit small Save. → **D1: explicit small Save.**
- [x] **Done kind** — force a kind pick vs default `Call` (one-tap) with inline change. Lean: default `Call`. → **D2: default `Call` + inline picker + optional note.**
- [x] **Escape hatch** — keep a small "+ note"/backdate affordance vs drop. Lean: keep small. → **D3: keep, collapsed.**
- [x] **Byproduct logging** — confirm `dealer_activities` writes stay (0088 counts) vs next-action-only. Lean: keep. Write `decision.md`. → **D4: keep. See [decision.md](decision.md) (incl. D5 mechanics).**

#### Phase 2: Server — "complete next action"
- [x] Implement Done as a `logDealerActivity` call (kind + optional note + the new next-action in one submit) OR a thin dedicated path if cleaner; stamp `last_contacted_at`; clear/replace `next_action`. → **No server change needed (D5): `logDealerActivity` already inserts the touch, stamps `last_contacted_at`, and patches `next_action` when present (replace when typed, clear to null when blank).**
- [x] Unit tests for the Done path (records a row, stamps last-contacted, advances the promise; archived/active guards still hold). Gate-matrix row only if a new exported action is added. → **Added "clears the completed commitment when Done sends an empty next-action" to `actions.test.ts`; the replace-promise + backdate + 0-rows-guard cases were already covered. No new exported action ⇒ no gate-matrix row.**

#### Phase 3: Panel reshape
- [x] Next-action **hero** at the top: prominent commitment field + due + Save (per Phase-1 save model); show overdue/ due-soon styling consistent with the queue. → **Brand-tinted hero section; idle shows a "Set commitment" form; a set commitment shows loud text + `DueChip` (overdue red ⚠ / due-today amber, matching the queue column) + Done + Edit.**
- [x] **Done** affordance on the current next-action → records the touch (kind default per Phase 1) + prompts for the next promise; remove the standalone 5-field Log-activity form. → **`Done` opens an inline kind(=Call default)+note+next-commitment+due form → `logDealerActivity` in one submit. The always-on 5-field log form is gone (replaced by the collapsed escape hatch).**
- [x] Stage / Priority / Owner → compact secondary row. → **Single compact badge/value row (+ Last contacted) with a collapsed "Edit details" → 3 selects + Save (`setDealerPipeline`, next-action omitted so the commitment is preserved).**
- [x] Recent-activity list stays; small "+ note"/backdate escape hatch per Phase 1. Locked-once-active behavior preserved. → **Recent list unchanged; "+ Log a past touch" disclosure (kind/when/note → `logDealerActivity`, next-action omitted). `locked` branch (active dealer = read-only history) preserved.**

#### Phase 4: Tests + smoke
- [ ] Unit/integration: Done flow end-to-end (activity row born + last-contacted + next-action advanced); no regression to `setDealerPipeline`/queue.
- [ ] Smoke (web-test): `/dealerships/[id]` panel — next-action hero renders, Done flow present, no duplicate next-action field, no standalone log form; `/dealerships` queue unaffected. Read-only (no submits on the shared auth user).
- [ ] Update `data-model.md` (byproduct-logging flow). Visual smoke (manual) screenshot of the reshaped panel.
