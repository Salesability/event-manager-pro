# Go-live: accounts to create for production

> Part of `docs/wiki/`. See [`index.md`](index.md) for the catalog and [`log.md`](log.md) for the maintenance log.
> This is the **provisioning runbook** for moving the app to production: the external accounts the business
> must own, what each is for, and what to hand back to the developer to wire it up. The current set of
> services is derived from `.env.example` + [`architecture.md`](architecture.md).

## How to read this doc

There are **two roles**:

- **You (the business owner)** — create each account, attach **your** billing, turn on 2FA, and either invite
  the developer or hand over the keys. **You own these accounts** so the business keeps control of its data,
  its books, and its signed contracts.
- **Your developer** — does the technical setup *inside* each account (creating the project, running the
  database, configuring login, deploying the app). You don't need to do these parts.

Each section below is marked **You do** / **Developer does** so the boundary is clear.

### Two rules before you start

1. **Use the business's email and card, not a personal or the developer's account.** If a developer's
   personal account owns the database or the e-signature service, the business doesn't actually control its
   own contracts and customer data. Sign up as the business (`owner@salesability.ca` or similar), pay with the
   business card, and *grant the developer access* — don't let the developer be the owner.
2. **Never send secrets (API keys, passwords) over email or text.** Use a shared password manager (1Password,
   Bitwarden) or hand them over in person/screen-share. These keys are the equivalent of the master key to the
   building.

---

## At a glance

| Service | What it's for | Who owns it | Rough cost (verify current pricing) |
|---|---|---|---|
| **Supabase** | The database + staff login | Business | Free tier exists; **Pro (~US$25/mo)** recommended for a live business (daily backups, no auto-pause) |
| **Resend** | Sends quote / contract emails | Business | Free tier covers low volume; Pro (~US$20/mo) for a verified domain + headroom |
| **BoldSign** | E-signatures on MSAs + quotes | Business | Paid (per-sender plans, ~US$10–40/mo); has a free trial |
| **Twilio** | Campaign SMS sends (chunk 0103) | Business | Pay-as-you-go (~US$2/mo toll-free number + ~US$0.008/segment to Canada); trial credit to start |
| **Google Cloud** | Hosting + PDF storage + "Sign in with Google" | Business | Pay-as-you-go; **likely under ~US$10–20/mo** at this scale, plus a card on file |
| **Domain / DNS** | The app's web address (`eventpro.salesability.ca`) | Business | Already owned (salesability.ca); just DNS records |

> **Not needed for launch:** QuickBooks (one-time dealer import — see [`../chunks/closed/0060-quickbooks-integration/`](../chunks/closed/0060-quickbooks-integration/intent.md))
> and the shareable Google Sheet (deferred — see [`../chunks/future/0058-production-sheet-and-date-range/`](../chunks/future/0058-production-sheet-and-date-range/plan.md)).
> Skip those for now.

---

## 1. Supabase — database + staff login

**What it's for.** Holds all the data (clients, contacts, quotes, campaigns) and runs staff sign-in.

**You do**
1. Go to **supabase.com** → sign up with the business email → turn on 2FA.
2. Create an **Organization** named for the business, and pick a plan. **Pro** is recommended for a live
   business — the Free tier pauses projects after inactivity and only keeps short backups.
3. Invite the developer to the organization (Settings → Team), **or** hand them the project keys below.

**Developer does**
- Creates the project (region: a Canadian/US-East region close to your users), runs the database migrations,
  configures the Google login provider, and turns **"Allow new users to sign up" OFF** (staff are invited, not
  self-serve — see [`auth.md`](auth.md)).

**Hand back to the developer** (Supabase dashboard → Settings):
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` *(secret — password manager only)*
- Database connection string (Settings → Database → URI) → `DATABASE_URL` *(secret)*

> **Stage vs prod are separate Cloud Run services in separate GCP projects (deploy).** `deploy.sh` keys the **GCP project**, service, URL, and DB secret on `DEPLOY_APP_ENV`, so the two environments run side by side (separate projects, both under the `salesability.ca` org) and a deploy to one never overwrites the other:
> | Env | GCP project | Service | URL | DB secret |
> |---|---|---|---|---|
> | `DEPLOY_APP_ENV=production` | `eventpro-498313` (business-owned) | `event-manager-pro` | `…run.app` | `database-url-production` |
> | sandbox (any non-prod) | `eventpro-stage` (salesability.ca org) | `event-manager-pro-<env>` (e.g. `-sandbox`) | `…-<env>…run.app` | `database-url` |
> The script prints a **DEPLOY TARGET** banner (env · project · service · url · DB secret) before building, and a `production` deploy also requires a typed `production` confirmation (bypass with `DEPLOY_CONFIRM=production` for non-interactive/CI use). ⚠️ `DEPLOY_APP_ENV` **defaults to `production`** (real emails + prod-tier BoldSign + prod DB + prod project), so always set it explicitly for stage: `DEPLOY_APP_ENV=sandbox ./deploy.sh`. Override the project with `GCP_PROJECT_ID`. Stage and prod now both live under the **`salesability.ca`** org (`admin@salesability.ca`) — one gcloud login covers both (stage moved off the personal `nnwweb` project 2026-06-08; stage URL `https://event-manager-pro-sandbox-485010152235.us-east4.run.app`). The `production` typed-confirmation gate, not the account, is what guards a mis-targeted prod deploy.
>
> **Fresh project in this org needs three one-time grants `deploy.sh` does *not* do** (the org enforces Domain Restricted Sharing + no auto-IAM for default SAs, so a new project starts locked down): (1) org-policy override `constraints/iam.allowedPolicyMemberDomains` → `allValues: ALLOW` at the project level, or Cloud Run can't bind `allUsers` and the public URL 403s; (2) `roles/cloudbuild.builds.builder` on the `<projectnum>-compute@developer.gserviceaccount.com` SA (covers the Cloud Build source bucket **and** runtime GCS) — without it `builds submit` fails with `storage.objects.get … denied`; (3) the env's own GCS PDF bucket + matching `GCS_BUCKET`/`GCS_PROJECT_ID` (stage = `eventpro-stage-pdfs`, prod = `eventpro-498313-pdfs`). All three were applied to `eventpro-stage` on 2026-06-08; prod (`eventpro-498313`) already carried them.
>
> **Production DB secret.** The prod runtime `DATABASE_URL` lives **only** in the GCP-managed **`database-url-production`** secret (never in `.env.local`). For a production DB, the developer:
> 1. Applies **all migrations to the prod DB first** — `DATABASE_URL=<prod-session-pooler:5432> pnpm db:migrate` (use the **session pooler / direct** connection on 5432, not the transaction pooler on 6543 — DDL needs a transactional connection).
> 2. Creates the secret once: `printf '%s' '<prod-URI>' | gcloud secrets create database-url-production --project=eventpro-498313 --replication-policy=automatic --data-file=-`.
> 3. Deploys: `DEPLOY_APP_ENV=production ./deploy.sh` (it errors with these steps if the secret is missing). To rotate the URL later: `… | gcloud secrets versions add database-url-production --data-file=-`.

---

## 2. Resend — outbound email

**What it's for.** Sends the transactional emails (quote sent, contract ready, etc.).

**You do**
1. Go to **resend.com** → sign up with the business email → turn on 2FA.
2. Add and **verify your sending domain** (e.g. `salesability.ca`). Resend shows a few DNS records (SPF/DKIM)
   to add — do this with whoever manages your domain's DNS (see §5). Verification is what lets mail come *from*
   `something@salesability.ca` instead of a sandbox address, and keeps it out of spam folders.
3. Decide the **"from" address** (e.g. `events@salesability.ca` or `quotes@salesability.ca`).

**Developer does**
- Wires the API key and from-address into the app and sends a test.

**Hand back to the developer:**
- API key → `RESEND_API_KEY` *(secret)*
- The chosen from-address → `RESEND_FROM_EMAIL` (must be on the verified domain)

> ⚠️ Until the domain is verified, Resend only delivers to the address you registered with — real customers
> won't receive mail. Verify the domain before launch.

---

## 3. BoldSign — e-signatures

**What it's for.** Sends the Master Service Agreement + first quote for legally-binding e-signature, and tells
the app when a customer has signed.

**You do**
1. Go to **boldsign.com** → sign up with the business email → turn on 2FA.
2. **⚠️ Pick the Canada region when creating the account.** BoldSign segments accounts by region (US / EU /
   Canada). The business is in Nova Scotia, so choose **Canada** — and tell the developer you did, because a
   Canada-region key only works against the Canadian API host (`api-ca.boldsign.com`). Getting this wrong
   produces a confusing "invalid authentication" error later.
3. **⚠️ Buy the right plan — this app sends via the API, so it needs the *Enterprise API* plan, NOT the
   per-user "Web App" plans.** On BoldSign's pricing page there are two tabs: **API Pricing** and **Web App
   Pricing**. The Web-App plans (Essentials $0 / Growth $5 / Business $15 / Premium $99) only grant a
   **Sandbox** API key — production sends (`isSandbox=false`) are rejected with them. You must buy the
   **Enterprise API** plan (API Pricing tab, **~$30/mo, 40 docs included, $0.75/doc after**) to unlock the
   **Live/production** environment + a Live API key. It also includes **Webhooks**, which the signed-MSA
   round-trip requires. The **Free Sandbox** is test-only (watermarked docs, deleted after 14 days). This
   account signs documents *as the business*, so it must be the business's own account. **(Discovered
   2026-06-08: prod was on Free Sandbox → the first real Send Test MSA failed; see the Send Test MSA note below.)**

**Developer does**
- Generates the API key, registers the app's webhook URL (`/api/boldsign/webhook`) with a signing secret, and
  runs a live test signature.
- **Verify prod BoldSign anytime from the app (0067):** sign in as an admin → **Send Test MSA** (`/admin/send-test-msa`)
  posts a real test envelope to a typed address (use your own) and shows the BoldSign document id. Re-run after any
  key rotation, region change, `MSA_TEMPLATE_VERSION` bump, or redeploy. (The signed test envelope is acked by the
  webhook via its `metaData.test` flag — it has no MSA row.)

**Hand back to the developer:**
- API key → `BOLDSIGN_API_KEY` *(secret)*
- Which **region** you chose → `BOLDSIGN_API_BASE_URL` (Canada = `https://api-ca.boldsign.com`)
- *(The developer generates `BOLDSIGN_WEBHOOK_SECRET` themselves when registering the webhook.)*

**Sender identity — who the signer sees (chunk 0092).** BoldSign attributes each envelope to
**whichever org member owns the API key**, *not* to the MSA's named signatory. The prod Live
account (team "Default", CA region) is owned by **`admin@salesability.ca` — David Hogan, Account
Admin**; **`shannon@salesability.ca` — Shannon Tilley** is an **Active Member** of the same team
(verified via `GET /v1/users/list` 2026-06-23). So by default envelopes read "David Hogan requested
your signature."

> ⚠️ **Do NOT use `onBehalfOf` / `BOLDSIGN_SENDER_EMAIL` for this — it breaks the signed-MSA
> webhook.** Tried 2026-06-23 (chunk 0092) and rolled back same day. Setting
> `SendForSign.onBehalfOf=shannon@…` *does* make the envelope come from Shannon, but it **transfers
> document ownership to Shannon and locks the API-key owner (David's key, which the app uses) out of
> the document**: `GET /v1/document/download` and `/properties` return **403 Forbidden**, and the doc
> is invisible in the key's `list`/`teamlist`/`behalfList`. Our webhook downloads the signed PDF with
> that key (`route.ts` → `getSignedFileBytes`) *before* flipping the MSA to `active`, so a 403 there
> makes the webhook 502 → **the signed MSA never activates and the PDF is never archived.** The
> `onBehalfOf` code stays in `client.ts` (env-gated, inert) but the env var must stay **unset**.

**Correct way to send *as Shannon* (in progress 2026-06-24):** point the prod app at a
BoldSign API key generated **under Shannon's user**. Then documents are *owned by Shannon* — sent from
Shannon **and** downloadable by her key (webhook works). Steps: ✅ promote Shannon to Admin → ✅ she
creates a **Live** key (both done 2026-06-24) → ✅ staged as `boldsign-api-key` **v4** (now `:latest`;
v3 = David's key still enabled as the rollback) → ⏳ **prod redeploy** (held — owner staging) so a new
revision picks up `:latest`, then verify. Keep `BOLDSIGN_SENDER_EMAIL` unset. Verify via Send Test MSA: from Shannon **and**
the webhook download returns 200. ⚠️ Cloud Run pins the secret version per-revision, so the swap only
takes effect after a prod redeploy; and any **in-flight David-owned MSA** (e.g. Summerside Hyundai)
may 403 on Shannon's key if signed *after* the swap — confirm it's signed/voided first, and keep
David's key (the current `boldsign-api-key` v3) re-addable as the rollback.

---

## 4. Google Cloud — hosting, PDF storage, and "Sign in with Google"

**What it's for.** Three things at once: it **hosts the app** (Cloud Run), **stores the generated PDFs** (quote
/ contract / invoice files), and provides the **"Continue with Google" login** button staff use.

This is the most technical account — but your part is just billing and ownership; the developer does the rest.

**You do**
1. Go to **cloud.google.com / console.cloud.google.com** → sign in with the business Google account (a Google
   Workspace account on `salesability.ca` is ideal) → turn on 2FA.
2. Set up a **Billing account** with the business card. (Costs at this scale are small, but Google requires a
   card on file.) Optionally set a **budget alert** (e.g. email me if spend exceeds $50/mo) for peace of mind.
3. Add the developer as a project **Owner/Editor** (IAM → Grant access).
4. Decide the **app name + support email** that staff will see on the "Sign in with Google" consent screen
   (this is your branding — e.g. "Salesability Events").

**Developer does**
- Creates the project, deploys the app to **Cloud Run**, creates the **storage bucket** for PDFs, sets up the
  service identity (so no key file is needed in production), and configures the Google OAuth login client and
  feeds it into Supabase.

**Hand back to the developer:** mostly access, plus —
- The **project ID** → `GCS_PROJECT_ID`
- *(The developer chooses the bucket name → `GCS_BUCKET`, and uses workload identity in production so no
  credential file is needed.)*

### 4a. Google Calendar — event distribution (chunk 0077)

**What it's for.** Booked campaigns project from the app into real calendars — the **coach** and **dealer contact**
get the event as guest invites, plus a shared **read-only team calendar** that carries the whole schedule
colour-by-coach. The app stays the source of truth; the calendar is a one-way projection. See the concept page
[`calendar-distribution.md`](calendar-distribution.md).

**Auth model — keyless (no key file).** The org blocks downloadable service-account keys, so the app authenticates
keyless: the Cloud Run runtime SA impersonates a dedicated calendar SA via IAM `signJwt`, which signs a
domain-wide-delegation (DWD) assertion to act as a licensed Workspace user (DWD is **required** to invite guests).
The dealer-facing **organizer** is the calendar's **display name**, not that user — so no person's name is on the
invite and no per-seat `events@` mailbox is ever needed (decision `../chunks/closed/0077-calendar-distribution/decision.md` §3/§4a).

**Provisioned (project `eventpro-498313`, 2026-06-12):**
- SA **`eventpro-calendar@eventpro-498313.iam.gserviceaccount.com`** (Client ID `101571815389036082153`) — the keyless signer; never dealer-visible.
- Calendar API enabled (`calendar-json.googleapis.com`).
- Runtime SA `1094204863648-compute@developer.gserviceaccount.com` granted `roles/iam.serviceAccountTokenCreator` **on** `eventpro-calendar` (resource-scoped — it can impersonate only this one SA). The developer's own identity (`admin@`) needs the same grant for local dev.
- DWD authorized in the Workspace Admin console: Client ID `101571815389036082153` → scope `https://www.googleapis.com/auth/calendar.events` (minimal).
- Shared calendar created on `shannon@salesability.ca`: ID **`c_eb45f29a4477f0e879861e24e1cdfaeed04ad140a1f5172919e22b82a57943c5@group.calendar.google.com`**.

**Three env vars** (single source — flipping the subject is the entire future `events@` rebrand): set in `.env.local`
(dev) and `deploy.sh` (prod):
- `GOOGLE_CALENDAR_SA_EMAIL=eventpro-calendar@eventpro-498313.iam.gserviceaccount.com`
- `GOOGLE_CALENDAR_ID=c_eb45…@group.calendar.google.com`
- `GOOGLE_CALENDAR_SUBJECT=shannon@salesability.ca`
- (`SITE_URL` must also be set — the event's back-link needs an absolute origin.)

The dealer-visible **display name is "EventPro"** — the owner's chosen organizer brand (confirmed 2026-06-12); no rename needed.

**Owner steps still pending:** (1) **share the calendar read-only** to staff (coaches + admin) so they can
overlay it; (2) set the three env vars on the deploy (prod-only, already wired in `deploy.sh`). Verify with the live round-trip:
`NODE_OPTIONS='--conditions=react-server' pnpm dlx tsx scripts/0077-calendar-smoke.ts`.

### 4b. Production feed → Google Sheet (chunk 0097)

**What it's for.** A read-only, token-gated CSV of **booked + upcoming** campaigns (delivery-focused
columns only — Start/End Date, Dealer, Location, Format, Coach, Records, SMS-Email, Letters, BDC; **no
notes, no contact PII**) that an owner-owned **Google Sheet** pulls via `=IMPORTDATA()` and shares with
third-party implementers. One-way, no Google API, no DWD scope. Route: `GET /api/production-feed?token=…`
(public path; the gate is the bearer token, constant-time compared).

**Secret:** `production-feed-token` (a long random bearer token). The route reads it from
`PRODUCTION_FEED_TOKEN`; when unset the route fails closed (500 "not configured").

**Status (2026-07-07): ACTIVE in prod.** Steps 1–2 below are done — `production-feed-token` secret
created (v1) in `eventpro-498313`, compute SA granted `secretAccessor`, mount uncommented in
`cloudbuild.deploy.yaml` (`b4f7f01`), deployed on revision `event-manager-pro-00046-mrm`. Verified live:
no-token → 401, valid-token → 200 CSV (header + rows, PII-clean). Only **step 4 (create + share the Sheet)**
remains, owner-side.

**Owner steps to go live (prod):**
1. ~~**Create the secret** in the prod project:~~ **DONE 2026-07-07.**
   ```
   printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create production-feed-token \
     --project=eventpro-498313 --replication-policy=automatic --data-file=-
   gcloud secrets add-iam-policy-binding production-feed-token --project=eventpro-498313 \
     --member=serviceAccount:1094204863648-compute@developer.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor
   ```
2. ~~**Wire the mount.**~~ **DONE 2026-07-07** — mount appended to the `--set-secrets` line in
   `cloudbuild.deploy.yaml`; the keyless main→prod trigger carries it. (`deploy.sh` also auto-mounts it via
   its mount-if-present block.)
3. **Build the URL.** `https://eventpro.salesability.ca/api/production-feed?token=<the secret value>`
   (read it back with `gcloud secrets versions access latest --secret=production-feed-token
   --project=eventpro-498313`, or copy it from the admin panel on `/production`).
4. **Create the Google Sheet**, put `=IMPORTDATA("<that URL>")` in cell A1, and **share the Sheet** with
   the implementer emails. Google refreshes it ~hourly.

**Rotate** by adding a new secret version + updating the Sheet's formula (or the admin-panel URL). The token
is a bearer credential visible in the Sheet formula + logs — acceptable because the feed is low-sensitivity
(redacted) and rotatable. For local dev, set `PRODUCTION_FEED_TOKEN` in `.env.local`.

---

## 5. Domain & DNS — the app's address

**What it's for.** The web address staff and customers use, and the DNS records that prove you own your email
domain (needed by Resend).

**You do**
1. Make sure you (the business) control DNS for **salesability.ca** (the registrar or DNS host login).
2. Grant the developer access to add records, **or** be available to paste in the records they send you.

**Developer does**
- Points a subdomain (planned: **`eventpro.salesability.ca`**) at the deployed app, and adds the Resend
  verification records from §2.

**Hand back to the developer:**
- The agreed app address → `SITE_URL` (e.g. `https://eventpro.salesability.ca`)
- DNS access (or a quick turnaround when records need adding)

---

## 6. Twilio — campaign SMS

**What it's for.** Sends campaign text messages to a dealership's customer list (the SMS add-on a dealer
buys for an event, chunk 0103), and reports back per-message delivery status + STOP replies.

**You do**
1. Go to **twilio.com** → sign up with the business email → turn on 2FA.
2. Buy a **toll-free number** (Phone Numbers → Buy a Number → Toll-Free). Canada has no 10DLC registry;
   verified toll-free is Twilio's recommended route for application-to-person texting into Canada.
3. Create a **Messaging Service** (Messaging → Services) and attach the toll-free number to it. The app
   sends via the service, so the number can be swapped later without a code change.
4. **Submit toll-free verification** (the console prompts for a business profile, the use case — event
   marketing on behalf of dealerships — sample messages, and how recipients opted in). ⚠️ **Unverified
   toll-free numbers are blocked by carriers** — sends to real customers won't deliver until this is
   approved (typically days to a few weeks). Trial-mode sends to your own verified number work meanwhile.

**Developer does**
- Wires the credentials into Secret Manager (sandbox + prod split like Resend/BoldSign), points the
  Messaging Service's status callback at the app's webhook, and sends a stage test (dev-redirected).
- Generates `SMS_IDENTITY_HMAC_KEY` (`openssl rand -base64 32`, developer-side secret — no vendor
  account involved): keys the verification-only recipient fingerprint on the message ledger (chunk
  0105) so a dealer-list re-import after the 24-month purge can confirm person-continuity per number.

**Hand back to the developer:**
- Account SID → `TWILIO_ACCOUNT_SID` *(secret)*
- Auth token → `TWILIO_AUTH_TOKEN` *(secret)*
- Messaging Service SID (starts `MG…`) → `TWILIO_MESSAGING_SERVICE_SID`
- Verification status of the toll-free number (approved / pending)

> Research + sender-strategy rationale: [`docs/chunks/closed/0103-sms-service/research.md`](../chunks/closed/0103-sms-service/research.md).

---

## Developer-side config (no account needed — for reference)

These aren't vendor accounts; the developer sets them on the production deploy:

- `APP_ENV=production` — flips the app into live mode (also the safety switch that stops test emails leaking).
- `EMAIL_DEV_TO` — **left unset** in production (it's a dev-only inbox redirect).
- `SMS_DEV_TO` — **left unset** in production (dev-only phone redirect for campaign SMS, chunk 0103).
- `MSA_TEMPLATE_VERSION` — the active contract-wording version, bumped when the MSA prose changes.

## Hand-back checklist (one message to the developer)

When the accounts exist, the developer needs these collected (secrets via password manager, **never email**):

- [ ] Supabase: project URL, `anon` key, `service_role` key, database connection string
- [ ] Resend: API key, verified from-address — **domain verified?**
- [ ] BoldSign: API key, **region chosen (Canada?)**
- [ ] Google Cloud: project ID, developer added to IAM, billing active, consent-screen name/email
- [ ] Twilio: Account SID + auth token, Messaging Service SID, **toll-free verification submitted?**
- [ ] Domain: agreed app address (`eventpro.salesability.ca`), DNS access
- [ ] Confirm **2FA is on** for every account above

Once these are in hand, the developer runs the database migrations, deploys to Cloud Run, points the domain,
and runs a live end-to-end test (send a quote → sign it → confirm the email + signed PDF) before flipping the
business over to the new system.
