# 0060 — QuickBooks dealer import · runbook

How to get a QuickBooks **production** access token and run the one-time dealer import. The owner does
Phase 1 (Intuit login + consent are theirs); the script run is Phase 2/3.

## Phase 1 — Intuit-side setup (owner)

You sign in with the **same Intuit ID that owns the QuickBooks company**.

1. **Create the developer app.** Go to <https://developer.intuit.com> → sign in → **Dashboard → Create an
   app → QuickBooks Online and Payments**. Name it (e.g. "Salesability dealer import"). On the scopes
   prompt, select **`com.intuit.quickbooks.accounting`** (Accounting). Payments scope is **not** needed.

2. **Get PRODUCTION keys.** In the app, open **Keys & credentials** and switch from *Development* to the
   **Production** tab → **Get production keys** (a.k.a. "Production Settings"). Intuit requires a short
   form before it reveals the keys:
   - **Host domain / launch URL, EULA URL, Privacy Policy URL** — use your salesability.ca pages. (This
     app isn't being published to the QuickBooks App Store; the form is just to unlock production keys for
     your own company.)
   - Submit → you get a **Production Client ID + Client Secret**. (We don't actually need the secret for
     the Playground token, but production keys must exist before the Playground will issue production
     tokens.)

3. **Allow the Playground redirect.** Open the **OAuth 2.0 Playground**: from the app Dashboard click
   **"Test connect to app (OAuth)"**, or go to <https://developer.intuit.com/app/developer/playground>.
   - Select your app and the **Production** environment, scope **Accounting**.
   - The Playground shows the **Redirect URI it will use** (typically
     `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl`). **Copy that exact URI** and add it
     under the app's **Production → Redirect URIs**, then Save. (If it's already listed, skip.)

4. **Mint the token.**
   - In the Playground, click **Get authorization code** → an Intuit window opens → sign in and **pick
     your production QuickBooks company** → **Connect / Authorize**.
   - Back in the Playground, click **Get tokens**.
   - Copy two values: the **Access Token** and the **Realm ID** (the company id, shown alongside).

   ⚠️ The **access token is valid ~1 hour** — mint it right before running the import. (Ignore the refresh
   token; a one-time run doesn't need it.)

## Phase 2 — Dry run (no writes)

Point `DATABASE_URL` at the **prod** Supabase **session pooler (port 5432)** — see project memory /
`docs/wiki/go-live-accounts.md` for the connection string. Then, from the repo root:

```bash
QBO_ACCESS_TOKEN='<access token>' \
QBO_REALM_ID='<realm id>' \
DATABASE_URL='<prod session-pooler URL on :5432>' \
pnpm dlx tsx scripts/import-from-quickbooks.ts
```

This **writes nothing**. It prints: how many customers it fetched, every dealer it would create with its
staff contact, any sub-customers/jobs it's skipping, and how many company records have an email/phone but
no person name (those channels get dropped — no place to attach them without a person). **Review this.**

Options:
- `QBO_ENV=sandbox` — hit Intuit's sandbox company instead (for a pipeline test).
- `QBO_INCLUDE_INACTIVE=1` — include inactive QBO customers (default: active only).

## Phase 3 — Live import

When the dry run looks right, re-run with `IMPORT_WRITE=1` (token may need re-minting if >1h passed):

```bash
IMPORT_WRITE=1 \
QBO_ACCESS_TOKEN='<fresh access token>' \
QBO_REALM_ID='<realm id>' \
DATABASE_URL='<prod session-pooler URL on :5432>' \
pnpm dlx tsx scripts/import-from-quickbooks.ts
```

It prints inserted/reused/linked counts. The import is **idempotent** — safe to re-run (dealers match on
name+address, contacts on the email/phone unique index; nothing duplicates).

**Verify:** open `/dealerships` in the app and confirm the imported dealers appear (`acquired_via` =
"QuickBooks import"); spot-check a couple of staff contacts on a dealer detail page.

## Troubleshooting

- **`401 from QBO`** — token expired (the ~1h window) or wrong environment. Re-mint from the Playground;
  confirm `QBO_ENV` matches the keys you used (production vs sandbox).
- **`Missing env`** — one of `QBO_ACCESS_TOKEN` / `QBO_REALM_ID` / `DATABASE_URL` is unset.
- **Fewer dealers than expected** — check the "skipping N sub-customers/jobs" line; v1 flattens those out.
  Re-run with `QBO_INCLUDE_INACTIVE=1` if some are marked inactive in QBO.

## Executed — 2026-06-05 (one-time seed, PRODUCTION)

Ran against prod (`eventpro-498313` / `database-url-production`, session pooler `:5432`) via
`./scripts/with-prod-db.sh`. Pre-flight: live QBO re-export was byte-identical to the approved
`qbo-import-preview.csv`; dry-run clean; prod had 0 prior QuickBooks-import dealers (fresh seed).

**Result:** 146 customers fetched → **137 dealers inserted** (0 reused), **133 staff links**, 4 dealers
without a contact, 4 dropped channels (company email/phone, no person). 130 dealers carry a CA province,
7 imported province-less. The 133 links resolve to 119 distinct contacts — 13 reps are shared across >1
dealer (the email/phone unique index deduped people across dealerships).

**Dedup added before the run:** `Palmers Motor Company*` (QBO Id 414) is a duplicate of `Palmers Motor
Company` (Id 397) — same contact + email. Added to `DEDUP_NAMES` in the script; the asterisked record is
skipped, the canonical one kept. (Palmers is a UK dealer, intentionally retained with no CA province.)

**Manual follow-ups in-app:**
- Set province on the 6 CA dealers QBO had no subdivision for: Rallye Motors Nissan, Grand Falls Hyundai,
  Porsche of Halifax, Charlottetown Mitsubishi, Sturgeon Falls Chrysler, Tantramar Chevrolet. (The 7th
  province-less dealer is Palmers Motor Company — UK, correctly has none.)
- Optionally add a staff contact to the 4 no-person dealers (Alan Ferguson, Browns VW, Exclusive Private
  Sales, Kentville Mitsubishi) — their QBO email/phone had no person name so the channel was dropped.
- `Bruce Hyundai`'s staff email identifier holds two comma-joined addresses
  (`bdeveau@…,mlaffin@…`) straight from QBO — split into one primary if it matters for sending.
