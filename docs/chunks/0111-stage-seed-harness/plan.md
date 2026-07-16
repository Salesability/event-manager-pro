# Stage seed harness — marker-owned demo-seed modules — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-16

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Runner + environment guards] | Done | a630353 |
| 2: [Demo dealer + campaign module] | Done | d769246 |
| 3: [SMS recipients + history modules] | Done | ef07f2c |
| 4: [Century Mazda fixture migration + smoke-script promotion] | Pending | - |
| 5: Tests + smoke verification | Pending | - |

Generalize the per-chunk `insert|cleanup` smoke-fixture pattern into a permanent `scripts/seeds/` harness: ordered modules with `seed`/`clean`, marker-owned rows, hard prod-refusal, one `pnpm seed:demo` entry point. Done = the SMS-line demo state is reproducible from a clean sandbox in one command, idempotently, and the 2026-07-15 ad-hoc fixtures are off the real Century Mazda campaign.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `scripts/seeds/index.ts` (runner: ordered walk, `--clean`, `--only`) | `scripts/0110-console-polish-smoke.ts` (arg parsing, pg/drizzle bootstrap, FK-ordered cleanup, `.finally(pg.end)`) | The proven insert\|cleanup CLI shape this harness generalizes |
| Environment guard (prod-ref refusal + explicit opt-in) | `scripts/with-prod-db.sh:1` (the inverse posture — explicit, IAM-gated prod access) + `deploy.sh`'s typed prod confirm | Same belt-and-suspenders doctrine, opposite direction: seeds must *never* reach prod ref `fkfybeddnfxnjuxkqidp` |
| `scripts/seeds/10-demo-dealer.ts` (dealer + booked campaign, `demo-` publicIds) | `scripts/0108-booking-smoke.ts:55` (`insert()` — dealer + campaign + settings with FIXTURE_MARKER publicIds) | Same entity chain, same marker convention being formalized |
| `scripts/seeds/20-sms-recipients.ts` (consent-mix list + identity fingerprints) | 2026-07-15 Century Mazda one-off (reproduced in this plan's folder notes; `computeIdentityHmac` via `NODE_OPTIONS=--conditions=react-server` for the `server-only` import) | The exact narrative fixture being made permanent |
| `scripts/seeds/30-sms-history.ts` (send + messages + thread + labels) | `scripts/0110-console-polish-smoke.ts:64` (`insert()` — send/messages/thread/opt-out fabrication with expected funnel numbers) | Same fabricated-history shape; keep the printed expected-numbers contract |
| `package.json` `seed:demo` script | `package.json:14` (`db:*` script family) | Same script-naming vocabulary |

**Conventions referenced:**
- `db-conventions` skill — Drizzle client usage, FK-order deletes, no DDL here
- `docs/wiki/sms.md` — thread model + funnel semantics the fabricated history must reconcile with
- `docs/wiki/go-live-accounts.md` — prod ref / sandbox ref identities behind the guard

**Overall Progress:** 60% (3/5 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- Phase 3 carries the intent's fabricated-history leaning (fabricate, clearly marked); Phase 4 depends on the demo-dealer module replacing the Century Mazda piggyback

### Phase Checklist

#### Phase 1: [Runner + environment guards]
- [x] `scripts/seeds/guard.ts` — pure target classifier: prod-ref (`fkfybeddnfxnjuxkqidp`) hard refusal regardless of flags; sandbox ref (`qppenapeguwevcheqwpz`) + localhost allowlisted; anything else refused unless `SEED_DEMO_ALLOW_UNKNOWN_TARGET=1` (bcgov-style explicit opt-in)
- [x] `scripts/seeds/index.ts` — runner: `.env.local` self-load (`process.loadEnvFile`, integration-test pattern), guard before connect, ordered module registry walk (clean-then-seed per module = idempotent), `--clean` (reverse order), `--only <module>`
- [x] `package.json` `seed:demo` script + vitest `include` glob for `scripts/seeds/**/*.test.ts`
- [x] Guard unit tests: prod ref refused even with opt-in; sandbox/local pass without opt-in; unknown target needs opt-in; missing URL refused

#### Phase 2: [Demo dealer + campaign module]
- [x] `scripts/seeds/markers.ts` — shared ownership markers (`demo-` publicId prefix, reserved `+1999555` phone block distinct from the 0108/0110 smoke blocks)
- [x] `scripts/seeds/10-demo-dealer.ts` — Demo Motors dealer + upcoming booked campaign (`smsEmail: 100`) + booking settings; `findDemoCampaignId` lookup for downstream modules; scoped clean (appointments → campaign [recipients/settings cascade] → dealer)
- [x] Runner order fix: default run = full reverse clean pass, then forward seed pass (per-module clean-then-seed breaks on `restrict` FKs from later modules)
- [x] Live verify on sandbox: seed twice → identical rows; `--clean` → zero marker rows

#### Phase 3: [SMS recipients + history modules]
- [x] `scripts/seeds/20-sms-recipients.ts` — 6-recipient consent-mix list on the demo campaign (4 eligible across express/implied_purchase/implied_inquiry, 1 stale-CASL implied_purchase @ 25 months, 1 opted-out via `stop_reply` registry row), identity fingerprints via `computeIdentityHmac`, fixed `demo-booking-token` on the responder
- [x] `seed:demo` script gains `NODE_OPTIONS=--conditions=react-server` (the `server-only` import inside `src/lib/sms/identity.ts` — same trick as the 2026-07-15 one-off)
- [x] `scripts/seeds/30-sms-history.ts` — fabricated send (`demo-` providerSids) + 5 ledger messages with consent/identity snapshots + responder thread (name snapshot, positive/hot labels, outbound+inbound transcript); printed expected-numbers contract: funnel 5 sent / 4 delivered / 1 response / 4 no response / 1 stop; pre-send 6 imported / 4 eligible / 1 opted out / 1 stale
- [x] Live verify on sandbox: seed twice → identical counts; funnel/pre-send numbers match the printed contract

#### Phase 4: [Century Mazda fixture migration + smoke-script promotion]
- [ ] Task 1
- [ ] Task 2

#### Phase 5: Tests + smoke verification
- [ ] Integration test: seed twice → identical counts; clean → zero marker rows, zero non-marker rows touched; prod-ref URL → non-zero exit before any write
- [ ] Smoke (web-test): `goto /calendar/<demo-campaign-id>/sms` — pre-send chips incl. both exclusion rows, funnel strip numbers match the module's printed contract
- [ ] Smoke (web-test): `goto /messages` — demo thread with name, turn-state, sentiment dot + temperature badge; `goto /sms` — demo row with aggregates
- [ ] `pnpm seed:demo --clean` sweep verified (marker rows gone; Century Mazda campaign back to pre-2026-07-15 state)
