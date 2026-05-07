# SaleDay Events — Platform Development Roadmap (May 2026)

> **What this is.** A near-term roadmap prepared by Salesability Canada Inc. in May 2026. Three planned phases for the SaleDay Events platform: **Google Calendar Integration**, **Shareable Production List for Service Providers**, and **Quote / MSA / E-Signature Workflow**.
>
> **⚠ Important context — read before relying on this doc.** This roadmap was written from the perspective of the **legacy app** (`deprecated/index.html`), not this repo. The "Current Platform" feature table reflects what the legacy Netlify + Google Sheets + vanilla-JS app does in production at `events.salesability.ca`. The "Technology Stack" and "Deployment Instructions" sections likewise describe the legacy stack (Netlify, Apps Script, Squarespace CNAME). **Don't use those sections as authority for this repo's stack** — see [`docs/wiki/architecture.md`](../wiki/architecture.md) for actual Cloud Run + Next.js + Drizzle + Supabase truth.
>
> **What is forward-looking.** The three planned phases. They map directly onto this repo's port-then-new-surface plan in `architecture.md`:
>
> | Roadmap phase | Where it lands in this repo |
> |---|---|
> | **Phase 1** — Google Calendar Integration | New chunk; not yet scaffolded. Equivalent server-side OAuth flow but via Server Actions, not Netlify Functions. |
> | **Phase 2** — Shareable Production List | Partial overlap with `docs/designs/closed/0013-production-export/` (CSV/print) and the parked `docs/designs/0010-calendar-share-full/` work. The "shareable read-only link" idea may justify a new design chunk. |
> | **Phase 3** — Quote / MSA / E-Signature | This is the **"new surface"** in [`docs/wiki/architecture.md`](../wiki/architecture.md) §Migration roadmap step 5: Quote (PDF + email) → Contract (Dropbox Sign send + webhook → store signed PDF) → Invoice (Stripe) → Payment-received webhook. Same Dropbox Sign API key noted in the legacy app's compromised-secrets list (must be rotated — see `architecture.md` §Compromised legacy secrets). |
>
> **Why it lives here.** Pairs with [`vision.md`](vision.md) — vision is long-horizon platform expansion (DataLoader + Production Console + Event Manager); this roadmap is the near-term scheduling-app phases that come before any of that.
>
> **Source.** Imported verbatim from `SaleDay_Events_Development_Roadmap.docx.md` on 2026-05-05. Markdown export artifacts (`\|`, `\.`, etc.) preserved as-is.

---

**SaleDay Events**

Platform Development Roadmap

*Salesability Canada Inc.   |   Prepared May 2026   |   CONFIDENTIAL*

# **Project Overview**

SaleDay Events is a proprietary sales event management platform built for Salesability Canada Inc. It enables the team to book, manage, and track automotive dealership sales events across Canada — with full calendar visibility, production reporting, and coach assignment management.

This document outlines the completed features, current platform status, and the planned development phases for the next stage of the platform — including Google integration, automated client documents, and e-signature workflows.

# **Current Platform — Live at events.salesability.ca**

**The following features are fully built and operational:**

| Feature | Status |
| :---- | :---- |
| Username / password login | **✅ Live** |
| Monthly calendar with event ribbons | **✅ Live** |
| Coach colour coding & filter pills | **✅ Live** |
| Book / edit / delete events | **✅ Live** |
| Auto-fill client contact details | **✅ Live** |
| Event duration 1–5 days | **✅ Live** |
| Block out dates (single or range) | **✅ Live** |
| Production list with search & filter | **✅ Live** |
| Export CSV & print production list | **✅ Live** |
| Booking summary by client/coach/month | **✅ Live** |
| Manage clients & coaches | **✅ Live** |
| Manage event styles & data sources | **✅ Live** |
| Per-coach shareable calendar links | **✅ Live** |
| Google Sheets data sync | **✅ Live** |
| SaleDay Events branding & logo | **✅ Live** |

# **Development Phases — Next Stage**

The following three phases represent the planned enhancements to the SaleDay Events platform. Each phase is independent and can be developed and deployed separately.

## **Phase 1 — Google Calendar Integration**

Restore the connection between SaleDay Events and Google Calendar so that every booked event automatically appears in the team's shared calendar.

* When an event is booked → automatically create a Google Calendar event

* When an event is edited → update the calendar entry

* When an event is deleted → remove the calendar entry

* Calendar event includes: dealership name, dates, coach, format, and contact details

* Reminders: email 24 hours before, popup 2 hours before

* Colour-coded by coach in Google Calendar

*Technical approach: Implement Google OAuth 2.0 flow using a server-side Netlify Function to avoid browser popup issues. Token stored securely in Netlify environment variables.*

## **Phase 2 — Shareable Production List for Service Providers**

Create a clean, always-up-to-date shareable view of the production schedule that can be shared with Vicimus and other service providers — without giving them access to the full app.

* Auto-syncing Google Sheet tab (Upcoming\_Sales\_Events) — already partially built

* Shareable read-only link to the production schedule

* Columns: Event Date, Dealership, Contact, Phone, Event Format, Data Source, Qty Records, SMS/Email, Letters, BDC, Coach, Notes

* Filter by month or upcoming events only

* Auto-refreshes when events are added or changed in the app

* Optional: password-protected shareable web view

*This gives Vicimus and other providers real-time visibility into the schedule without requiring any login or access to the full platform.*

## **Phase 3 — Quote, MSA & E-Signature Workflow**

Build a complete client document workflow that generates professional estimates and legal agreements, and sends them for e-signature directly from the app.

**Document Generation**

* Branded Estimate/Quote with full event details, service checklist, and pricing

* Pricing fields: Event Fee, Travel Expenses, HST, optional Deposit

* Quote includes SaleDay Events sell sheet as attachment

* Master Services Agreement (MSA) pre-filled with client name and event details

* All 10 sections with exact legal wording as approved

* Both documents editable before sending

**E-Signature Workflow (Dropbox Sign / HelloSign)**

* Step 1: Click "Send Estimate" → client receives email with estimate \+ sell sheet

* Step 2: Client signs estimate → MSA automatically triggered and sent

* Step 3: Client signs MSA → confirmation email sent to client and coach

* Shannon countersigns both documents as second signer

* Signature request ID logged to event record for tracking

* Signed PDF copies automatically emailed to all parties

**Technical Requirements**

* Dropbox Sign API key: already configured (API key on file)

* Netlify Function to proxy API calls (bypasses browser CORS restrictions)

* Webhook endpoint to trigger MSA after quote is signed

* Confirmation email function for post-MSA notification

# **Technology Stack**

| Component | Technology | Notes |
| :---- | :---- | :---- |
| **Frontend** | HTML / CSS / Vanilla JS | Single file app — easy to deploy |
| **Hosting** | Netlify | events.salesability.ca — free tier |
| **Database** | Google Sheets | DealerEvent Pro — Master Data |
| **Authentication** | Username / Password | Users tab in Google Sheet |
| **Serverless Functions** | Netlify Functions (Node.js) | API proxying — no server needed |
| **Sheet Writes** | Google Apps Script | Deployed web endpoint |
| **E-Signature** | Dropbox Sign (HelloSign) | API key configured |
| **Domain** | salesability.ca (Squarespace) | CNAME → Netlify |
| **Version Control** | GitHub | Private repository |

# **Key Credentials & Access**

*The following credentials are required for platform operation. Store securely and do not share externally.*

| Service | Details |
| :---- | :---- |
| **Live URL** | https://events.salesability.ca |
| **Netlify Site** | events.salesability.ca project |
| **GitHub Repo** | saledayevents (private) |
| **Google Sheet** | DealerEvent Pro — Master Data |
| **Google Cloud Project** | My First Project |
| **Google OAuth Client** | DealerEventPro (Web application) |
| **Apps Script Endpoint** | Deployed — sheet write proxy |
| **Dropbox Sign** | API key configured in Netlify function |
| **Admin Login** | Shannon — see Users tab in Google Sheet |

# **Deployment Instructions**

**How to update the live app at events.salesability.ca:**

1. 1\.  Download the latest index.html (and any function files) from Claude or GitHub

2. 2\.  Place in the Dealer Event Pro 1 folder on Desktop

3. 3\.  Folder structure must be: index.html \+ netlify.toml \+ netlify/functions/

4. 4\.  Go to app.netlify.com → events.salesability.ca → Deploys

5. 5\.  Drag the Dealer Event Pro 1 folder onto the deploy box

6. 6\.  Wait for green Published confirmation

7. 7\.  Open https://events.salesability.ca — Cmd+Shift+R to hard refresh

# **Development Notes & Known Limitations**

* Google Calendar sync is currently disabled pending OAuth server-side implementation (Phase 1\)

* Sheet writes use Google Apps Script endpoint — requires the deployed script to remain active

* Dropbox Sign free tier allows 3 documents/month — upgrade may be needed for production volume

* User passwords stored in plain text in Google Sheet — suitable for small trusted team only

* API keys are stored in HTML file — acceptable for current usage, move to environment variables for scaling

* App is a single HTML file — all logic, styling and content in one file for simplicity of deployment

*SaleDay Events is proprietary software developed exclusively for Salesability Canada Inc.*

*Developed with Claude AI (Anthropic) — May 2026*
