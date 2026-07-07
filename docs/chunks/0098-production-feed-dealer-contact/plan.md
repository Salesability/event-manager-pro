# Production feed — dealer primary contact columns — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: `loadDealerPrimaryContacts` loader + Contact columns in the pure model | Done | `2eb8759` |
| 2: Compose in the feed route | Done | `2eb8759` |
| 3: Tests (redaction rewrite + positive dealer-contact assertions) + smoke | In Progress (tests done; smoke+deploy pending) | `2eb8759` |

Add `Contact` / `Contact Phone` / `Contact Email` / `Notes` to the production feed CSV — the first three sourced from the dealer's **`is_primary`** contact (chunk 0089, not the campaign booking contact), `Notes` from `campaigns.notes` (owner-requested; previously redacted as "internal-only", now deliberately surfaced). "Done" = the feed returns the four appended columns, the campaign's own contact/phone/email + audience source stay redacted (notes no longer redacted), the header contract stays additive, and tests are green. No new secret, no migration; ships on the next `main` push.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `loadDealerPrimaryContacts(dealerIds)` in `src/features/schedule/queries.ts` — exported Map<dealerId,{name,phone,email}> | `src/features/schedule/queries.ts:166` (`fetchPrimaryDealerContacts` — the `is_primary`-then-lowest-id primary link) + `:203` (`fetchPrimaryIdentifiers` — email/phone off `contact_identifiers`) | Reuse the two existing private helpers; the new export just composes them + resolves `firstName/lastName` → a display name. Same query-module layer. |
| `FEED_HEADERS` + a contact-aware row mapper in `src/features/schedule/production-feed.ts` | `src/features/schedule/production-feed.ts:23` (`FEED_HEADERS`) + `:48` (`mapCampaignToFeedRow`) | Extend the pure model in place; keep it DB-free by passing the resolved contact into the mapper (don't reach into the DB from the pure module). |
| Feed route composition | `src/app/api/production-feed/route.ts:52` (`loadCampaigns()` → `selectFeedCampaigns` → CSV) | Same route; insert `loadDealerPrimaryContacts(dealerIds)` between load and map, then thread the contact map into the mapper. |
| Redaction test rewrite | `src/features/schedule/production-feed.test.ts:93` (`never leaks notes, contact, phone, email…`) + `src/app/api/production-feed/route.test.ts:104` (redaction assert) | Keep the campaign-booking-contact SENTINEL redaction; add a dealer-primary-contact fixture + assert it DOES appear. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealer_contacts.is_primary` (0089) is the dealer's designated primary contact; `contact_identifiers` holds the primary email/phone.
- 0097 redaction discipline (`production-feed.ts` header comment) — the pure model never touches `notes`/booking-contact/audience source; the *dealer* primary contact is a new, deliberate exception.

**Overall Progress:** 67% (2/3 phases complete; Phase 3 tests done, smoke+deploy pending)

### Phase Checklist

#### Phase 1: `loadDealerPrimaryContacts` loader + Contact columns in the pure model
- [x] `queries.ts`: export `loadDealerPrimaryContacts(dealerIds: number[]): Promise<Map<number, { name: string; phone: string | null; email: string | null }>>` — compose `fetchPrimaryDealerContacts` (name from `firstName`+`lastName`) + `fetchPrimaryIdentifiers` (email/phone). Empty input → empty Map (mirror the existing helpers' early return).
- [x] `production-feed.ts`: append `'Contact'`, `'Contact Phone'`, `'Contact Email'`, `'Notes'` to `FEED_HEADERS` (after `'BDC'` — additive, order is a contract).
- [x] `production-feed.ts`: change the row mapper to take the resolved dealer contact, `mapCampaignToFeedRow(c, contact?)` (`contact` is the exported `FeedDealerContact | undefined`); emit the 3 contact cells (blanks when absent) then `c.notes ?? ''`. Module stays **pure** (no DB, no `Date`).
- [x] Unit: mapper emits exactly `FEED_HEADERS.length` cells; dealer contact fills the 3 contact cells + `notes` fills the 4th; `undefined` contact + null notes → 4 trailing blanks. (`production-feed.test.ts` 7/7.)

#### Phase 2: Compose in the feed route
- [x] `route.ts`: after `loadCampaigns()` + `selectFeedCampaigns(...)`, collect the surviving rows' `dealerId`s and call `loadDealerPrimaryContacts(dealerIds)`; map each row with its dealer's contact via `contacts.get(c.dealerId)`.
- [x] Keep the token gate + fail-closed behavior untouched (contact load happens only after auth, after `loadCampaigns`).

#### Phase 3: Tests + smoke verification
- [x] `production-feed.test.ts`: rewrite the redaction test — the campaign's own `SENTINEL_CONTACT/PHONE/EMAIL` + audience source still **never** appear; dealer-primary-contact fixture asserts name/phone/email **do** appear; `SENTINEL_NOTES` **does** appear in the `Notes` cell.
- [x] `route.test.ts`: mock `loadDealerPrimaryContacts` alongside `loadCampaigns`; 200-CSV has the 4 new headers + a row's dealer contact + notes, no booking-contact/audience-source leak. (route.test.ts 4/4.)
- [ ] Smoke (owner-verify on prod, sandbox DB paused): after deploy, `GET /api/production-feed?token=<valid>` → 200 CSV with `Contact,Contact Phone,Contact Email,Notes` populated for a dealer with a primary contact; widen the shared Sheet's `IMPORTRANGE` to `A:N`.
- [ ] Deploy: ships on the next `main` push (keyless prod trigger); no new secret.
