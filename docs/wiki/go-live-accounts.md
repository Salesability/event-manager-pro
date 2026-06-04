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
| **Google Cloud** | Hosting + PDF storage + "Sign in with Google" | Business | Pay-as-you-go; **likely under ~US$10–20/mo** at this scale, plus a card on file |
| **Domain / DNS** | The app's web address (`eventpro.salesability.ca`) | Business | Already owned (salesability.ca); just DNS records |

> **Not needed for launch:** QuickBooks (one-time dealer import — see [`../chunks/0060-quickbooks-integration/`](../chunks/0060-quickbooks-integration/intent.md))
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

> **Stage vs prod are separate Cloud Run services in separate GCP projects (deploy).** `deploy.sh` keys the **GCP project**, service, URL, and DB secret on `DEPLOY_APP_ENV`, so the two environments run side by side (different projects, owned by different Google accounts) and a deploy to one never overwrites the other:
> | Env | GCP project | Service | URL | DB secret |
> |---|---|---|---|---|
> | `DEPLOY_APP_ENV=production` | `eventpro-498313` (business-owned) | `event-manager-pro` | `…run.app` | `database-url-production` |
> | sandbox (any non-prod) | `nnwweb` (dev / Network Node) | `event-manager-pro-<env>` (e.g. `-sandbox`) | `…-<env>…run.app` | `database-url` |
> The script prints a **DEPLOY TARGET** banner (env · project · service · url · DB secret) before building, and a `production` deploy also requires a typed `production` confirmation (bypass with `DEPLOY_CONFIRM=production` for non-interactive/CI use). ⚠️ `DEPLOY_APP_ENV` **defaults to `production`** (real emails + prod-tier BoldSign + prod DB + prod project), so always set it explicitly for stage: `DEPLOY_APP_ENV=sandbox ./deploy.sh`. Override the project with `GCP_PROJECT_ID`. Because prod and stage live under different Google logins, switch the active gcloud account/config before a prod deploy (a wrong account fails closed with a permission error).
>
> **Production DB secret.** The prod runtime `DATABASE_URL` lives **only** in the GCP-managed **`database-url-production`** secret (never in `.env.local`). For a production DB, the developer:
> 1. Applies **all migrations to the prod DB first** — `DATABASE_URL=<prod-session-pooler:5432> pnpm db:migrate` (use the **session pooler / direct** connection on 5432, not the transaction pooler on 6543 — DDL needs a transactional connection).
> 2. Creates the secret once: `printf '%s' '<prod-URI>' | gcloud secrets create database-url-production --project=nnwweb --replication-policy=automatic --data-file=-`.
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
3. Choose a plan (there's a free trial; a paid per-sender plan is needed for ongoing live use). This account
   signs documents *as the business*, so it must be the business's own account.

**Developer does**
- Generates the API key, registers the app's webhook URL (`/api/boldsign/webhook`) with a signing secret, and
  runs a live test signature.

**Hand back to the developer:**
- API key → `BOLDSIGN_API_KEY` *(secret)*
- Which **region** you chose → `BOLDSIGN_API_BASE_URL` (Canada = `https://api-ca.boldsign.com`)
- *(The developer generates `BOLDSIGN_WEBHOOK_SECRET` themselves when registering the webhook.)*

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

## Developer-side config (no account needed — for reference)

These aren't vendor accounts; the developer sets them on the production deploy:

- `APP_ENV=production` — flips the app into live mode (also the safety switch that stops test emails leaking).
- `EMAIL_DEV_TO` — **left unset** in production (it's a dev-only inbox redirect).
- `MSA_TEMPLATE_VERSION` — the active contract-wording version, bumped when the MSA prose changes.

## Hand-back checklist (one message to the developer)

When the accounts exist, the developer needs these collected (secrets via password manager, **never email**):

- [ ] Supabase: project URL, `anon` key, `service_role` key, database connection string
- [ ] Resend: API key, verified from-address — **domain verified?**
- [ ] BoldSign: API key, **region chosen (Canada?)**
- [ ] Google Cloud: project ID, developer added to IAM, billing active, consent-screen name/email
- [ ] Domain: agreed app address (`eventpro.salesability.ca`), DNS access
- [ ] Confirm **2FA is on** for every account above

Once these are in hand, the developer runs the database migrations, deploys to Cloud Run, points the domain,
and runs a live end-to-end test (send a quote → sign it → confirm the email + signed PDF) before flipping the
business over to the new system.
