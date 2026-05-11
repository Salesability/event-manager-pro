# Data model

Reference for the current Postgres schema. Source of truth is `src/lib/db/schema/`; this doc explains the shape, the key relationships, and the rationale that isn't obvious from the column list.

> Part of `docs/wiki/`. See `docs/wiki/index.md` for the full catalog and `docs/wiki/log.md` for the maintenance log. Per-chunk working notes (plans, decisions, research) live in `docs/designs/YYYY-MM-DD-slug/`.

> **Vocabulary aligned to the [STAR Standard](https://www.starstandard.org/) (Standards for Technology in Automotive Retail) Domain Map.** Mapping:
> - `dealers` ← STAR *Dealer Profile* (Bounded Context 1, Party & Identity)
> - `contacts` ← STAR *Customer Profile* / *Party* root (BC 1) — every person known to the system, regardless of side. The single master person record.
> - `dealer_contacts` (junction) — them-side role-tagged dealer↔contact relationships (`customer | staff | prospect`)
> - `team_member_roles` (junction) — us-side role assignments on a contact (STAR *Staff Member*, BC 12; `admin | staff | coach | viewer | dealer`)
> - `contact_identifiers` ← STAR *Identifier* (BC 7, Core & Common Entities)
> - `vehicles` ← STAR *Vehicle* (BC 2, Inventory & Vehicle Management)
> - `campaigns` ← STAR *Marketing Campaign* (BC 6, Marketing & Loyalty) — what we run for the dealer
> - `audience_sources` (lookup) — audience-source provenance for a dealer's marketing campaign (Dealer Database, PBS, Third Party List, Previous Buyers). Renamed from `sales_lead_sources` in 0038; the prior name carried three overloaded meanings (audience source, future per-campaign target table, dealership acquisition source) — see [`docs/wiki/log.md`](log.md) 2026-05-11 entry.

## Overview

Three things to know up front:

1. **One master person table — `contacts` — covers everyone.** Us-side staff and them-side dealer audiences are the same kind of entity (a person), distinguished only by their *role assignments*:
   - `team_member_roles` — us-side internal-app roles (`admin | staff | coach | viewer | dealer`). One row per (contact, role).
   - `dealer_contacts` — them-side per-dealer role-tagged relationships (`customer | staff | prospect`). One row per (dealer, contact, role).

   A single contact can have rows in both tables (e.g. a coach we hired from a dealership: one `team_member_roles(role='coach')` row + one historical `dealer_contacts(role='staff')` row from the dealership-employment days). Identity is never duplicated. This mirrors STAR's *Party* root abstraction — every identity-bearing entity flows through one master record.

   **Every contact has at least one active role** (0023 Phase 5 invariant). The role is what classifies the person — admin, coach, dealer, etc. Enforced app-layer:
   - `createPerson` / `updatePerson` reject when the desired role set is empty (after the appAccess coercion that drops admin/coach without app access).
   - `createDealer` / `updateDealer` auto-assign `dealer` whenever a staff link is created (with `onConflictDoUpdate` un-archiving the role if it was previously archived).
   - The Phase 2 backfill (`scripts/backfill-dealer-role.ts`) ensured every existing dealer-side contact got a `dealer` row; re-running is a no-op.

   **Two carve-outs:**
   - `archivePerson` archives all active `team_member_roles` rows in a single tx. The contact stays unarchived (so historical FKs keep resolving), so it temporarily has zero active roles. The invariant is "every NEW or UPDATED contact carries a role," not "every active contact at every moment." Reactivating a person via `updateDealer` un-archives the dealer role per Phase 4's upsert.
   - `adoptOrphanAuthUser` creates a roleless stub contact for an orphan `auth.users` row (legacy-recovery path). The admin must edit the adopted person via `/admin/people` immediately afterward — the form's ≥1-role guard enforces a role pick.

   `dealer` is for them-side staff at customer dealerships and is filtered out of the staff-app gates (`is_staff_member()` SQL helper, `STAFF_APP_ROLES` constant in `src/lib/auth/load-team-membership.ts`, `requireStaffAccess()` page gate, `auth/callback` routing). Adding `dealer` to a contact does NOT promote them into the staff app.

   `contacts.user_id` (nullable, UNIQUE FK to `auth.users`) is the optional Supabase Auth link. It's populated for everyone with internal-app or dealer-portal access — typically every `team_member_roles` row implies a populated `user_id`, and most `dealer_contacts` rows do not (until a contact signs up to the portal). The schema does not enforce that coupling at the DB level — kept app-layer (Q #15) so we retain the flexibility to seed staff records ahead of provisioning, and so the deactivation flow can drop `app_metadata.role` and archive `team_member_roles` rows without orphaning the `contacts.user_id` link.

   `auth.users` itself is Supabase-managed and referenced via a Drizzle shadow declaration in `src/lib/db/schema/auth.ts` — never migrated.

2. **Domain rows are `bigint` IDs** via the `bigIdentity()` helper. There is no longer a uuid-PK domain table — `contacts.user_id` carries the auth uuid as a nullable FK rather than aliasing it as a PK. Tables exposed in dealer-portal URLs (`dealers`, `campaigns`) carry an additional `public_id` (nanoid 12-char URL-safe slug) for unguessable URLs — see *ID types* below.

3. **Audit columns are pervasive.** `timestamps`, `actors` (`created_by_id`, `updated_by_id` → `auth.users`), and `archivable` (`archived_at`) are mixins from `_columns.ts`, applied to every editable domain table. Lookup tables (`campaign_styles`, `audience_sources`, `blocked_dates`) skip `actors` because they're admin-config, not domain data.

## Layout

```
                  ┌──────────────────────────┐
                  │   auth.users (Supabase)  │
                  └─────────────┬────────────┘
                                │ user_id (nullable, UNIQUE)
                                │ ON DELETE SET NULL
                                ▼
                         ┌──────────────┐
                         │   contacts   │  ← master person record
                         │              │     (everyone, both sides)
                         └──┬────────┬──┘
                            │        │
            us-side roles   │        │   them-side relationships
                            ▼        ▼
            ┌───────────────────┐   ┌──────────────────┐
            │ team_member_      │   │ dealer_contacts  │
            │ roles             │   │  role: customer  │
            │  role: admin /    │   │      | staff     │
            │  staff / coach /  │   │      | prospect  │
            │  viewer           │   │  + DNC, source,  │
            │  + specialty      │   │    since, ...    │
            │  (when coach)     │   └────────┬─────────┘
            └───────────────────┘            │ dealer_id
                                             ▼
                                        ┌─────────┐
                                        │ dealers │
                                        └────┬────┘
                                             │ dealer_id (RESTRICT)
                                             ▼
              ┌────────────────────────────────────────┐
              │              campaigns                 │
              │  status: draft → booked →              │
              │          cancelled / completed         │
              └────────────────┬──────────────┬────────┘
                               │              │
                       style_id│              │ audience_source_id
                               ▼              ▼
                      ┌────────────────┐  ┌────────────────────┐
                      │ campaign_styles│  │ audience_sources │
                      └────────────────┘  └────────────────────┘

   ┌─────────────────────────────────┐
   │      availability_blocks        │
   │  start_date, end_date (incl.)   │
   │  kind: statutory_holiday        │
   │      | company_closure          │
   │      | coach_unavailable        │
   │  coach_id? → contacts           │
   │  region? (e.g. CA-ON)           │
   └─────────────────────────────────┘
```

Contacts cluster (the master person record + its identifiers + its vehicles):

```
       ┌──────────────────────────┐
       │        contacts          │
       │  first/last name,        │
       │  display_name (computed),│
       │  user_id → auth.users    │
       │  (nullable, UNIQUE)      │
       └─┬─────────────────────┬──┘
         │                     │
         ▼                     ▼
   ┌──────────────────────┐   ┌────────────────────────────┐
   │ contact_identifiers  │   │     vehicle_ownerships     │
   │  kind: email|phone   │   │  (M:N over time;           │
   │  value, is_primary   │   │   acquired_at, sold_at)    │
   └──────────────────────┘   └─┬──────────────────────────┘
   (1:N — multiple                │
    contact channels)              ▼
                              ┌──────────┐
                              │ vehicles │
                              │ vin, yr, │
                              │ mk, mdl  │
                              └──────────┘

   Vehicles persist across owners; ownership rows close/open
   on transfer. One open (sold_at IS NULL) ownership per vehicle.
```

Edges left out of the diagrams for clarity:

- `campaigns.coach_id` → `contacts.id` (`ON DELETE SET NULL`). Expected to point at a contact with a `team_member_roles(role='coach')` row — enforced at the app layer, not by a CHECK.
- `availability_blocks.coach_id` → `contacts.id` (`ON DELETE CASCADE`). Set only when `kind='coach_unavailable'`; null for `statutory_holiday` and `company_closure`. Expected to point at a contact with `team_member_roles(role='coach')` — app-enforced.
- Audit columns: every editable domain table has `created_by_id` / `updated_by_id` → `auth.users` (`ON DELETE SET NULL`) via the `actors` mixin.

## Tables at a glance

| Table | PK | Key columns |
|---|---|---|
| `auth.users` | `id` uuid | (Supabase-managed; identity only) |
| `contacts` | `id` bigint | `first_name`, `last_name`, `display_name` (computed), `user_id` (FK auth.users, nullable, UNIQUE) — master person record, both sides |
| `team_member_roles` | `id` bigint | `contact_id` (FK contacts, cascade), `role` enum (`admin\|staff\|coach\|viewer\|dealer`), `specialty` (nullable, used when `role='coach'`) — UNIQUE on `(contact_id, role)` |
| `dealer_contacts` | `id` bigint | `dealer_id` (FK dealers), `contact_id` (FK contacts), `role` enum (`customer\|staff\|prospect`), `do_not_contact`, `since` date, `source` text, `last_contacted_at`, `title` text (used when `role='staff'`) — UNIQUE on `(dealer_id, contact_id, role)` |
| `contact_identifiers` | `id` bigint | `contact_id` (FK contacts, cascade), `kind` enum (`email\|phone`), `value` (normalized), `is_primary` |
| `dealers` | `id` bigint | `public_id` (nanoid, UNIQUE), `name`, `address` |
| `vehicles` | `id` bigint | `vin` (UNIQUE, normalized), `year`, `make`, `model`, `trim` — one row per physical vehicle, persists across owners |
| `vehicle_ownerships` | `id` bigint | `vehicle_id` (FK vehicles), `contact_id` (FK contacts), `acquired_at`, `sold_at` (nullable) — junction; one open ownership per vehicle |
| `campaigns` | `id` bigint | `public_id` (nanoid, UNIQUE), `dealer_id` (FK), `coach_id` (FK contacts, expected `team_member_roles(role='coach')`), `style_id` (FK), `audience_source_id` (FK), `start_date`, `end_date`, `status` enum (`draft\|booked\|cancelled\|completed`), `fee`, `travel`, `deposit_pct`, `tax_pct`, `quote_valid_days`, plus inline day-of contact fields and service flags (see `campaigns` section below) |
| `campaign_styles` | `id` bigint | `label` (UNIQUE), `sort_order` |
| `audience_sources` | `id` bigint | `label` (UNIQUE), `sort_order` |
| `availability_blocks` | `id` bigint | `start_date`, `end_date` (inclusive), `kind` enum (`statutory_holiday\|company_closure\|coach_unavailable`), `coach_id` (FK contacts, nullable; required when `kind='coach_unavailable'`), `region` (nullable, e.g. `CA-ON`), `reason`, `source` |

## Relationships

Identity / auth:

- `auth.users` 1:0..1 `contacts` via `contacts.user_id` — optional auth link, populated for anyone with internal or portal access. UNIQUE so a person can't link to two contacts. `ON DELETE SET NULL` (deleting an auth user revokes access but doesn't delete the contact, who may still be a dealer's customer or otherwise referenced).

Role assignments:

- `contacts` 1:* `team_member_roles` — us-side roles. UNIQUE `(contact_id, role)` enforces one row per (person, internal role); a person can hold multiple internal roles by holding multiple rows (e.g. admin + coach). `ON DELETE CASCADE`.
- `dealers` *:* `contacts` via `dealer_contacts` — them-side, role-tagged. UNIQUE `(dealer_id, contact_id, role)` enforces *one row per (dealer, contact, role)*; multiple roles at the same dealer = multiple rows (e.g. an employee who's also a customer of their own dealership). `ON DELETE CASCADE` on both sides.

Domain edges:

- `dealers` 1:* `campaigns` via `campaigns.dealer_id` — booking owner. `ON DELETE RESTRICT`.
- `contacts` 0..1:* `campaigns` via `campaigns.coach_id` — assigned coach (expected `team_member_roles(role='coach')`, app-enforced). `ON DELETE SET NULL`.
- `campaign_styles` 1:* `campaigns` via `campaigns.style_id`.
- `audience_sources` 1:* `campaigns` via `campaigns.audience_source_id`.
- `contacts` 0..1:* `availability_blocks` via `availability_blocks.coach_id` — per-coach unavailability (expected `team_member_roles(role='coach')`, app-enforced; null for `statutory_holiday` and `company_closure` rows). `ON DELETE CASCADE` — a hard-deleted coach takes their unavailability rows with them.

Contact edges:

- `contacts` 1:* `contact_identifiers` — multiple emails / phones per contact. Partial unique on `(kind, value)` `WHERE archived_at IS NULL` enforces one contact per active identifier (strict-key dedup boundary).
- `contacts` *:* `vehicles` via `vehicle_ownerships` — many-to-many over time: one person can own multiple vehicles, and one vehicle changes owners as it's sold. `vehicle_ownerships` carries `acquired_at` / `sold_at`; the partial unique `(vehicle_id) WHERE sold_at IS NULL` enforces one current owner per vehicle.

Audit edges (every editable domain table):

- `created_by_id`, `updated_by_id` → `auth.users` — `ON DELETE SET NULL`. Applied to `contacts`, `team_member_roles`, `dealer_contacts`, `contact_identifiers`, `dealers`, `vehicles`, `vehicle_ownerships`, `campaigns` via the `actors` mixin. Lookup tables skip this.

## Identity & people

The model has **one master person record (`contacts`)** for everyone — us-side staff and them-side dealer audiences alike. Role-assignment lives in two parallel junction tables (`team_member_roles`, `dealer_contacts`) that share the same shape: a contact-FK, a role enum, and per-role state. This mirrors STAR's *Party* abstraction (BC 1's "source of truth for all identities: Staff, Customer, Vendor, Organization, Dealer") and ensures a single person who plays multiple roles — across sides or across dealers — never has duplicated identity.

### `auth.users` (Supabase)

Identity only. Owned by Supabase Auth — never declared, migrated, or written to from app code. Drizzle has a shadow declaration in `auth.ts` exposing the `id` column so other tables can FK to it. The `db-conventions` skill notes a drizzle-kit gotcha: generation emits `CREATE SCHEMA "auth"` and `CREATE TABLE "auth"."users"` despite `schemaFilter: ['public']` — those two statements get stripped from the generated SQL before it's applied.

### `contacts` — master person record

One row per person, ever, across all roles and all dealers.

Columns:

- `first_name`, `last_name` — display fields, not used for dedup
- `display_name` (computed) — human-readable label for UI
- `user_id` (FK `auth.users`, nullable, UNIQUE) — set when this person has internal-app or portal access. Populated for everyone in `team_member_roles` (in practice; not enforced by DB); populated for portal-using customers; null for everyone else. `ON DELETE SET NULL` on the auth side (deleting the auth user revokes access but preserves the person record).
- mixins: `timestamps`, `actors`, `archivable`

Deliberately thin. Per-side state, contact channels, and vehicles all live in their own tables so a single contact can have many of each.

The signup-trigger pattern depends on email confirmation: magic link confirms by definition; for Google OAuth, Supabase trusts Google's `email_verified` claim — fine for Workspace/Gmail. The trigger looks up a `contact_identifiers` row matching the new `auth.users.email` and back-fills `contacts.user_id` on the matching contact. One trigger covers staff and customers alike; differentiation happens via which role-junction has rows for that contact.

### `team_member_roles` — us-side role assignments

The internal-team analogue of `dealer_contacts`. One row per (contact, role).

- `contact_id` (FK contacts, `ON DELETE CASCADE`)
- `role` enum: `admin | staff | coach | viewer | dealer`
- `specialty` text (nullable) — coach-only field, e.g. "lease retention", "service drive". Sparse on non-coach rows; pragmatic over a separate `coach_details` side table at this scale (same trade-off as `dealer_contacts.title` for staff rows).
- mixins: `timestamps`, `actors`, `archivable`

UNIQUE `(contact_id, role)` enforces one row per (person, internal role). Multi-role internal staff (e.g. an admin who also coaches) hold multiple rows, the same shape as the `dealer_contacts` two-rows-per-(dealer, role) pattern. This is a structural change from the prior single-`role` enum on `team_members` and dissolves what was open Q #3.

Coaches are not a separate table — a coach is a `contacts` row with one `team_member_roles(role='coach')` row. `campaigns.coach_id` references `contacts.id`; the role is verified at the app layer (a CHECK would need a cross-table predicate).

Login routing: any `team_member_roles` row → internal app; otherwise, portal access via `dealer_contacts`. A contact who somehow holds rows in both (e.g. a coach we hired from a dealership who's still listed in `dealer_contacts(role='staff')` historically) routes to the internal app.

### `dealer_contacts` — dealer ↔ contact (many-to-many, role-tagged)

The same person can be related to multiple dealers, and to a single dealer in multiple roles. `dealer_contacts` is the junction:

- `dealer_id` (FK dealers, `ON DELETE CASCADE`)
- `contact_id` (FK contacts, `ON DELETE CASCADE`)
- `role` enum: `customer | staff | prospect`
- `do_not_contact` boolean — dealer-scoped opt-out (CASL is brand-scoped; consent doesn't propagate across dealers). Meaningful for `customer`/`prospect` outreach; N/A but stored for `staff` rows for schema uniformity.
- `since` (date) — when this relationship started (purchase date for `customer`, hire date for `staff`, lead-add date for `prospect`)
- `source` text — provenance of the relationship (import, manual entry, campaign N, dealership HR)
- `last_contacted_at` (nullable) — for cross-campaign suppression
- `title` text (nullable) — job title at the dealer; only set when `role='staff'`. Sparse on customer/prospect rows; pragmatic over a separate `dealer_staff_details` side table at this scale.
- mixins: `timestamps`, `actors`, `archivable`

Indexes:

- UNIQUE `(dealer_id, contact_id, role)` — *one row per (dealer, contact, role)* combination. A staff-member-who-also-bought-a-car gets two rows (one `customer`, one `staff`). This is the data-integrity boundary.
- Index on `(dealer_id, role)` for "list this dealer's customers / staff / prospects".
- Index on `(contact_id)` for "show all dealers and roles for this person".

Why two rows per (dealer, contact) when there are multiple roles, instead of one row with an array of roles or a bitmask: simpler queries (`WHERE role='customer'`), simpler uniqueness, and per-role state (DNC, source, since, title) is genuinely separate per role. Two rows is more normalized; we prefer the schema cost over the integrity loss. Same principle that drives `team_member_roles` to two-rows-per-multi-role-staff.

### Why one master person table, not two

Earlier drafts of this doc had `team_members` (us-side) as a separate table from `contacts` (them-side). The split looked clean but introduced asymmetry: a person who happened to be both us-staff and a dealer's customer (e.g. a coach we hired from a dealership) had to exist as two rows with no link between them. STAR's *Party* root explicitly covers Staff and Customer under the same umbrella; we now do the same.

The role-junction pattern (`team_member_roles`, `dealer_contacts`) is the same shape twice: a thin contact-FK + role enum + per-role state, with a UNIQUE that allows multiple roles per person via multiple rows. This symmetry simplifies reasoning — query "what does this person do for us / for them" the same way on either side.

The trade-off vs the old shape:

- **Lost:** the `team_members.id = auth.users.id` cascade-delete pattern. Auth-user deletes now `SET NULL` on `contacts.user_id` rather than cascading the person record away — which is *more* correct, since the person may still be a dealer's customer.
- **Gained:** symmetry, no identity duplication for cross-side people, multi-role internal staff for free, and STAR-pure modeling of identity.

## Dealers

### `dealers` — paying companies (typically dealerships)

Just `name` + `address` for now. The legacy app flattened the company and primary contact into a single row (`name | contact | phone | email | address`); the new schema does **not** — dealers have many contacts (via `dealer_contacts`), contacts can change role over time, and a portal user has to be a person rather than a company. Org-level `email` / `phone` are intentionally absent until there's a clear use (switchboard line, billing alias) — push contact info down to `contacts`/`contact_identifiers` by default.

The table is named `dealers` (matching the STAR Standard's *Dealer Profile* noun). The 99% case is automotive dealerships; STAR's umbrella also covers marine, powersports, medium/heavy-duty trucks, and construction equipment dealers, so the name holds even if we expand beyond cars.

## Contacts (vehicles, identifiers, dedup, privacy)

The `contacts` cluster (master person + identifiers + vehicles + ownership history) is the bulk of the data and the privacy-sensitive bit. The hard problem here is identity: contacts don't come with stable IDs, and the same person can be on multiple dealers' lists. The schema below splits identity into three layers — master record, fungible identifiers (email/phone), and assets (vehicles) — to make dedup and merge tractable.

### `contact_identifiers` — fungible contact channels

One row per known email or phone, one contact can have many:

- `contact_id` (FK contacts, `ON DELETE CASCADE`)
- `kind` enum: `email | phone` (extensible — future: external CRM IDs, etc.)
- `value` (normalized — lowercase email; phone in E.164)
- `is_primary` boolean — at most one primary per `(contact, kind)` pair, used for outbound
- `source` text — provenance (e.g. `"dealer_42_import_2026-04-30"`)

Indexes:

- Partial unique on `(kind, value)` `WHERE archived_at IS NULL` — enforces strict-key dedup: no two active contacts share an active identifier.
- Partial unique on `(contact_id, kind)` `WHERE is_primary` — at most one primary per kind.

This is the dedup boundary. Match-or-create on ingest looks up `(kind, value)`; hit ⇒ same contact; miss ⇒ create new.

This table maps to STAR's *Identifier* core entity (BC 7) — the `kind`/`value` pattern matches STAR's typed-identifier shape.

### `vehicles` — the vehicles themselves

One row per physical vehicle, identified by VIN. Vehicle attributes (year/make/model/trim) live here, *not* on the ownership row, because they don't change as the vehicle is sold:

- `vin` (17-char, normalized uppercase, `UNIQUE`)
- `year`, `make`, `model`, `trim`
- mixins: `timestamps`, `actors`, `archivable`

A vehicle's row persists across owners. When the car changes hands, we close one `vehicle_ownerships` row and open another — the `vehicles` row is untouched.

### `vehicle_ownerships` — who owns / owned what, when

The junction between `contacts` and `vehicles`. Many-to-many over time: a person owns multiple vehicles, and a vehicle has multiple owners across its life.

- `vehicle_id` (FK vehicles, `ON DELETE CASCADE` if the vehicle is purged)
- `contact_id` (FK contacts, `ON DELETE CASCADE`)
- `acquired_at` (date) — when this contact became the owner
- `sold_at` (date, nullable) — null means current owner
- `notes` — optional, e.g. "purchased from Dealer B, traded in 2024"
- mixins: `timestamps`, `actors`, `archivable`

Indexes:

- Partial unique on `(vehicle_id)` `WHERE sold_at IS NULL AND archived_at IS NULL` — at most one current owner per vehicle.
- Index on `(contact_id)` for "what does this person own" queries.
- Index on `(vehicle_id, acquired_at DESC)` for ownership-history queries.

Why split this way:

- A vehicle's history (build year, model) is one row, not duplicated per owner.
- Ownership transfers are a clean event: close the old row, open a new one. No data is lost.
- Service history (if added later) attaches to `vehicles`, not to a specific owner — accurate when the next owner brings the same car in.

VIN is **no longer a useful person-level dedup signal** once we model transfers explicitly: the same VIN belonging to two contacts over time is normal, not a duplicate. VIN dedup is now scoped to vehicles, which is the correct boundary.

> Beyond STAR: the standard models *Vehicle* but not personal ownership history across dealers. `vehicle_ownerships` is our extension; STAR-aligned downstream consumers can still ingest `vehicles` cleanly.

### Dedup strategy

- **Day-1: strict-key.** Match-or-create on normalized email or phone. Skip exact duplicates; surface ambiguous cases to a review queue.
- **Future: LLM-assisted merge.** When strict-key misses (typo'd email, formatting variants like "John A. Smith" vs "John Smith Jr."), an LLM judge prompted with two candidate records can return *same / different / unsure* with a justification. Auto-merge above a confidence threshold; queue *unsure* for human review. This belongs in the ingestion pipeline, not the schema — but it influences the schema in two ways: (1) we want a `contact_merges` audit log to record what was merged and why, (2) we want a non-destructive merge path so an erroneous LLM call can be rolled back.
- **Probabilistic / graph-based.** If volume justifies it, graduate to the inverted-index + adjacency-list pattern (Postgres-native, identifier → contact_id index plus a graph of contact-shared-an-identifier edges, BFS for connected components). Belongs in `contact_identifiers`-style tables; doesn't require a schema rewrite, just additional infrastructure.

### Privacy and scope

- **Right to be forgotten.** A contact requesting deletion triggers a hard delete of `contacts` (cascade to `contact_identifiers`, `vehicle_ownerships`, `dealer_contacts`, and `team_member_roles`). The `vehicles` row stays — the vehicle isn't the person, and it may have a current owner who didn't request deletion. Soft-archive is insufficient under GDPR/CCPA; the contact's PII has to actually go.
- **Cross-dealer visibility.** Dealer A should see only contacts they have a `dealer_contacts` row for. Implemented via RLS (open question — exact policy shape).
- **PII custody.** Adding `contacts` makes us a data custodian, not just a processor. Expect knock-on requirements: encryption at rest, breach disclosure obligations, data processing agreements with each dealer.

## Campaigns & lookups

### `campaigns` — bookings

Every campaign references one `dealer` (`ON DELETE RESTRICT` — never orphan a campaign), optionally a coach (`campaigns.coach_id` → `contacts.id`, `ON DELETE SET NULL`, app-enforced `team_member_roles(role='coach')`), and the two lookup tables (`campaign_styles`, `audience_sources`). Date range is enforced by a `CHECK` constraint (`end_date >= start_date`).

Pricing fields are stored on the campaign (`fee`, `travel`, `deposit_pct`, `tax_pct`, `quote_valid_days`) since these can vary per booking — the legacy schema put them on bookings too. **These columns are moving onto `quotes` per [`commercial-spine.md`](commercial-spine.md) (0037 / 0026 Phase 2);** once 0037 Phase 4 ships, this section is reframed as "operational delivery" — the campaign models the Event being run, the commercial terms live on the accepted Quote.

`status` is the lifecycle (`draft → booked → cancelled → completed`) — **not** soft-delete. Use the lifecycle for state transitions; use `archived_at` (via `archivable`) only on reference data.

`campaigns.contact` / `campaigns.phone` / `campaigns.email` are inline text fields holding the day-of contact — likely to migrate to a `contact_id` FK to `contacts` (open question; see below).

> Naming note: the STAR Standard's *Marketing Campaign* (BC 6) is what this table represents. Internally we still talk about "events" because the user's company runs event-marketing campaigns at dealerships — `campaigns` is the schema-level term, "event" is the day-to-day vocabulary. They mean the same thing.

### Lookup tables

- **`campaign_styles`** — labels for campaign kinds (`label` unique, `sort_order` for UI ordering, `archived_at` for retiring without deleting). Originated as a legacy `localStorage` list, moved to Postgres so all users share them.
- **`audience_sources`** — same shape and origin. The source of the dealer's contact list used as the *consumer audience* of a campaign (Dealer Database, PBS, Third Party List, Previous Buyers — seeded). Renamed from `sales_lead_sources` in 0038 to disambiguate from STAR's *Sales Lead* (BC 3, a process artifact — see open Q #6 for the future per-campaign target table, which picks a fresh name).

Both skip the `actors` mixin (they're admin config, not domain data) and carry only `archived_at` for retirement.

## Availability — `availability_blocks`

When the calendar can't take a booking, we record a row here. Three sources, one table:

- **Statutory holidays** — concrete dates, populated annually from an external dataset (e.g. the [`date-holidays`](https://www.npmjs.com/package/date-holidays) npm package). One yearly job seeds the upcoming year per region; manually overridable (observe Boxing Day even if optional locally; suppress one we don't observe).
- **Company closures** — explicit days the company doesn't operate (office retreats, holiday weeks, weather closures, end-of-year shutdown). Manually entered; usually ranges, not single days.
- **Coach unavailability** — per-coach time off (vacation, training, sick days). The booking-time check "can we book coach X on date Y" filters here.

Schema:

- `start_date`, `end_date` (date) — **inclusive both ends**. A one-day block has `start_date = end_date`. CHECK enforces `end_date >= start_date`. "Is date X blocked" → `WHERE X BETWEEN start_date AND end_date`.
- `kind` enum: `statutory_holiday | company_closure | coach_unavailable`
- `coach_id` (FK contacts, nullable, `ON DELETE CASCADE`) — required when `kind='coach_unavailable'`, null otherwise. App-enforced; could become a CHECK once the rule is stable.
- `region` text (nullable) — used for statutory holidays where jurisdiction matters (e.g. `'CA-ON'`, `'CA-BC'` — Family Day is provincial in Canada, Civic Holiday optional, etc.). Null = applies globally. Defer populating until we have a multi-province dealer footprint.
- `reason` text — human label (`"Family Day"`, `"Vacation"`, `"Office closed for retreat"`).
- `source` text (nullable) — provenance (`"date-holidays:CA"` for auto-generated stat holidays; null for manual entry).
- mixins: `timestamps`, `actors`, `archivable`.

Indexes:

- `(start_date, end_date)` — date-range coverage queries.
- `(coach_id, start_date)` partial `WHERE coach_id IS NOT NULL` — per-coach availability lookup.
- `(kind, start_date)` — "list this year's stat holidays" / per-source filtering.

Why one table, not three:

- The booking-time question is *one* question — "is date X bookable for coach Y?" — and joining or unioning across separate per-source tables gets awkward fast. One filtered scan answers it.
- The shape is genuinely the same: a date or range, optionally scoped to a coach, with a source label.
- The `kind` enum keeps the source distinction visible without forcing it into the table name.

Out of scope for this table:

- **Recurring weekday rules** ("we don't take bookings on Sundays") — generating 52 rows/year per recurring rule is awkward to maintain. Treat as app-level config for the global case; if per-coach weekly patterns become a thing, add an `availability_rules` table for RRULE-style entries. See open question.
- **Partial-day blocks** (morning-only vacation, afternoon training) — date-grain only on day-1. Add `start_time` / `end_time` columns later if booking grain shrinks below a day.
- **Dealer-side closures** — a dealer that won't take bookings on Mondays is dealer-scoped, not ours. Out of scope until evidence we need it; would belong on `dealers` or a `dealer_availability` side table.

## Cross-cutting

### Mixins (`_columns.ts`)

| Mixin | Columns | Applied to |
|---|---|---|
| `timestamps` | `created_at`, `updated_at` (auto-bumped) | All editable domain tables |
| `actors` | `created_by_id`, `updated_by_id` (uuid → `auth.users`, `ON DELETE SET NULL`) | Editable domain tables, including `availability_blocks` (coach unavailability is recorded per-user). Skipped on pure lookups (`campaign_styles`, `audience_sources`). |
| `archivable` | `archived_at` | Tables that need soft-archive (most lookups, `dealers`, `contacts`, `team_member_roles`, `dealer_contacts`, `vehicles`, `vehicle_ownerships`, `availability_blocks`). Note: `contact_identifiers` uses `archived_at` to retire a stale email/phone without breaking dedup history. |

Note: `auth.uid()` does **not** populate over Drizzle's direct connection. Server actions and webhooks must pass `userId` explicitly when writing audit columns.

### ID types

| Table | Internal PK | URL-exposed handle |
|---|---|---|
| `auth.users` | uuid | n/a (Supabase-managed) |
| `contacts`, `team_member_roles`, `dealer_contacts`, etc. | bigint identity | n/a (internal-only or RLS-scoped) |
| `dealers` | bigint identity | `public_id` (nanoid) |
| `campaigns` | bigint identity | `public_id` (nanoid) |

**Bigint + `public_id` hybrid.** Internal joins, FKs, and indexes use sequential `bigint` for B-tree locality and 8-byte width. Tables that surface in dealer-portal URLs (`/portal/d/{public_id}`, `/portal/campaigns/{public_id}`) carry an additional `public_id text not null unique` column holding a nanoid (12-char URL-safe slug, e.g. `V1StGXR8_Z5j`). The slug is generated in app code on insert (Node `nanoid` package), not via a Postgres `DEFAULT` — keeps the schema portable and avoids needing a UUID extension or PL/pgSQL function.

Why not UUID PKs:
- **UUIDv4** has poor B-tree locality on hot tables (`contact_identifiers`, `vehicle_ownerships` will hit millions of rows on bulk imports). Random inserts dirty random pages → write amplification.
- **UUIDv7** (time-ordered) would solve locality, but it's PG 18+ native and Supabase is on 17.6. Polyfill options exist (the [`cem/uuidv7`](https://database.dev/cem/uuidv7) TLE package or [Fabio Lima's PL/pgSQL gist](https://gist.github.com/kjmph/5bd772b2c2df145aa645b837da7eca74)), but they add a moving part for marginal gain over the hybrid above. Revisit if/when Supabase ships native PG 18.

`auth.users` keeps `gen_random_uuid()` (Supabase-managed). No domain table now uses uuid as a PK — `auth.users.id` flows in as a nullable FK on `contacts.user_id`, not as a PK alias.

## Open questions

These are the design threads not yet resolved as of 2026-04-30. Captured here so they don't get lost; resolved ones get pruned out.

1. **`campaigns.contact_id`** — replace inline `campaigns.contact` / `phone` / `email` with a FK to `contacts`? The campaign needs a tracked person to email quotes/contracts to. Day-of contacts who aren't yet in the CRM would need either a free-text fallback or an "ad-hoc contact" flow that creates a `contacts` + `dealer_contacts(role='staff' or 'customer')` pair on the fly.
2. **`dealers.address`** — single text field. Quote/invoice PDFs and shipping want structured (street, city, province, postal). Decide before the migration runs.
3. **Role-name collision: `staff` value in two enums** — both `team_member_roles.role` (us-side) and `dealer_contacts.role` (them-side) carry a `staff` value, meaning different things. Cosmetic but worth deciding before migrations harden the enums. Options: rename the us-side `staff` value (`ops`? `general`?), or accept that both enums use `staff` because each is contextually unambiguous (`team_member_roles.role='staff'` = "us-side general staff"; `dealer_contacts.role='staff'` = "dealership employee"). Default: accept; the table-name prefix disambiguates.
4. ~~**Signup trigger on `auth.users`** — needed to back-fill `contacts.user_id` when a portal user signs up.~~ **Resolved 2026-05-05:** shipped as `drizzle/0002_contact_user_backfill_trigger.sql` (`AFTER INSERT ON auth.users`, `SECURITY DEFINER`, idempotent). Looks up `contact_identifiers(kind='email', value=lower(NEW.email))` against unarchived contacts whose `user_id` is null and writes the linkage. Same logic covers staff and customers — differentiation happens via which role-junction has rows for that contact. Mostly insurance today (signups disabled); load-bearing the day a portal opens.
5. ~~**Service flags on `campaigns`** — `sms_email`, `letters`, `bdc`, `qty_records` are inline columns inherited from legacy. Decide whether to keep as bools, model as a `services` lookup with a join table, or drop unused ones.~~ **Resolved 2026-04-30:** kept inline as nullable `integer` (per-channel record counts), matching the legacy semantics. The `services` lookup + join-table option is deferred until reporting actually needs it.
6. **Per-campaign target list (name TBD — e.g. `campaign_targets`, `sales_leads`)** — should we record *which* contacts were targeted at each campaign? Enables per-record outcomes (delivered/bounced/responded), cross-campaign suppression, and ROI per record — at the cost of 10k–100k rows per campaign. This is the natural home for the STAR *Sales Lead* (BC 3) noun: a row per (campaign × contact) pair representing a lead being processed. Not needed day-1 if `campaigns.qty_records` (count) is enough. If/when built, picks a fresh name distinct from `audience_sources` (see 0038 for why the prior overloaded name was retired).
7. **Quote versioning** — pricing fields live on the campaign row, so re-sending a revised quote overwrites the prior numbers. If history matters (customer pushback, "what did we send last week?"), a `quotes` table captures versions; otherwise leave as-is.
8. **Contact dedup conflict resolution** — when two dealers' lists disagree about a contact's name, phone, or vehicle, who wins? Last-write-wins is simplest. Per-dealer overrides on `dealer_contacts` (a `name_override` / `phone_override` field) is more accurate. A "golden record" curated by an admin is most accurate but has a staffing cost.
9. **Cross-dealer visibility (RLS)** — Dealer A's portal user should see only contacts Dealer A has a `dealer_contacts` row for. Should they also see *which other dealers* know this contact (cross-pollination value) or be filtered to their own contributions only (privacy default)? Default to the privacy stance unless we explicitly sell cross-dealer enrichment.
10. **Right to be forgotten** — needs a hard-delete path through `contacts` → `contact_identifiers` / `vehicle_ownerships` / `dealer_contacts` / `team_member_roles`. The `vehicles` row stays put. Soft-archive is insufficient. Audit trail of the deletion request itself stays (in a separate table) without retaining the PII.
11. **LLM-assisted merge tooling** — when strict-key dedup misses, prompt an LLM with two candidate records and a yes/no/unsure judgment. Auto-merge above threshold, queue ambiguous cases for human review. Belongs in the ingestion pipeline; needs a `contact_merges` log to record decisions and a non-destructive merge path so bad calls can be rolled back.
12. **Identifier normalization** — emails: lowercase trim. Phones: E.164 via libphonenumber, but how do we pick a default region? Per-dealer setting on `dealers`, or app-wide? Probably per-dealer.
13. **Vehicle service history** — `vehicles` is the natural anchor for service records (oil changes, recalls, ownership-transfer inspections). Not in scope for campaign marketing, but the table is positioned to grow into it. If we add a `vehicle_service_records` table, it FKs to `vehicles.id`, *not* to an owner — so service history follows the car, which matches reality. STAR has *Vehicle Service History* in BC 4 — direct alignment if we go there.
14. **VIN normalization & validation** — VINs have a check-digit algorithm (ISO 3779 / NHTSA). Should we validate on ingest? Probably yes, to reject typos. Decide whether validation failure is a hard reject or a soft warning that still creates the row with a flag.
15. **Role-junction integrity rules** — should we enforce at the DB level that `team_member_roles` rows imply `contacts.user_id` is populated (internal staff need an auth principal to log in)? Or that `dealer_contacts(role='staff')` rows have a non-null `title`? **Resolved (`team_member_roles` ↔ `user_id` coupling) 2026-05-05:** kept app-enforced. The `setUserRoles` Server Action refuses to insert a `team_member_roles` row without a linked contact (`applyRoleSet` checks `contacts.user_id`), and `linkUserToContact` is the explicit attach point. Vitest covers the rejection paths. We avoided a DB-level CHECK because (a) cross-table predicates would need a trigger, (b) we want to seed staff records before provisioning auth, and (c) the deactivation flow archives roles without re-orphaning the contact. The `dealer_contacts(role='staff') → title NOT NULL` half is still open. Revisit if drift appears.
16. **Schema-source rename pass** — wiki vocabulary is now STAR-aligned and unified, but `src/lib/db/schema/` files (`clients.ts`, `customers.ts`, `events.ts`, `coaches.ts`, `blocked-dates.ts`, etc.), the Drizzle migrations under `drizzle/`, and any code that imports them haven't been renamed yet. The unification is structural (sales_leads + old contacts + old team_members → contacts + two role-junctions; `blocked_dates` PK=date → `availability_blocks` with id, kind, coach_id, range), so it'll need a fresh migration rather than a rename-in-place. Sequence the rewrite before any new migrations land or the gap will compound.
17. **Recurring availability rules** — modeling weekday patterns (no Sundays, no Monday afternoons) without exploding into 52 rows/year per rule. Default stance: keep `availability_blocks` for concrete dates only; if recurring rules are needed, treat the global case as app config and add a separate `availability_rules` table for RRULE-style entries when per-coach patterns appear.
18. **Holiday-seed automation** — annual job that calls `date-holidays` (or equivalent) and writes the upcoming year's stat holidays into `availability_blocks` with `kind='statutory_holiday'`. Idempotent insert keyed on `(kind, start_date, region)` so re-runs don't dupe; manual overrides (suppress/observe) survive re-seeds because they live on the same row's `archived_at` or have a distinct `source`. Decide where the job lives (cron, manual one-shot per year, Supabase Edge Function).
19. **Region/jurisdiction handling** — single tenant means one region today, so the `region` column stays null. Multi-province dealer footprint would require either a `region` per dealer (filter applicable stat holidays at booking-time) or per-campaign explicit override. Defer until evidence; the `region` column is the seam.
20. **Partial-day availability** — date-grain only on day-1. Decide whether morning/afternoon split matters (e.g. coach available AM but not PM on a given Friday) before adding `start_time` / `end_time`. If we add it, also reconsider the inclusive-both-ends date convention.
21. **Coach unavailability conflict precedence** — if a coach is blocked AND a global stat holiday covers the same date, the campaign can't be booked anyway. The booking-time check just unions all matching rows; no precedence rule needed unless we want to surface the *reason* differently in the UI ("blocked: Family Day" vs "blocked: coach on vacation"), in which case query order matters.
