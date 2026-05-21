# SaleDay Events — Production Software Vision (May 2026 PRD)

> **What this is.** A forward-looking product requirements document prepared by Salesability Canada Inc. in May 2026. It describes a three-module platform — **DataLoader**, **Event Production Console**, **Event Manager** — that *sits above* the existing SaleDay Events scheduling app (i.e. this repo, `event-manager-pro`).
>
> **What this is NOT.** Not an active plan. Not a chunk of work. Not the roadmap for `event-manager-pro` in isolation. The platform described here likely spans multiple deployments and integrations beyond this repo.
>
> **Why it lives here.** Lives in `docs/strategy/` (alongside [`roadmap.md`](roadmap.md)) because it's neither state-of-the-system reference (`docs/wiki/`) nor a per-chunk plan (`docs/chunks/`) — it's the strategic anchor behind the long-horizon roadmap. When future chunks get scaffolded — especially around compliance (CASL/DNCL), AI-assisted features, multi-channel campaigns, real-time dashboards, or BDC/Traffic Cop integrations — refer back to this doc to confirm intent and scope. Pairs with [`roadmap.md`](roadmap.md) which covers the near-term phases.
>
> **Source.** Imported verbatim from `SaleDay_Events_Production_Software_Plan.docx.md` on 2026-05-05. Markdown export artifacts (`\|`, `\+`, etc.) preserved as-is.
>
> **Relationship to current chunks:**
> - `docs/chunks/closed/0018-user-system/` (RBAC, contact-user linkage) — foundational for any role-aware module here (admin/coach/BDC/dealer per "Authentication" row in the stack table).
> - `docs/chunks/closed/0019-security-architecture/` (RLS defence-in-depth, audit log) — direct precondition for the multi-tenancy + PIPEDA-compliant data-isolation requirements called out in "Key Considerations."
> - `docs/chunks/future/0016-book-your-event-intake/` — early surface area for the "Event Created" workflow step described in Module 2's Campaign Workflow (deferred to v2 as of 2026-05-11; v1 uses an in-app manual form).
> - `docs/chunks/closed/0014-summary-reports/` — foreshadows the Module 3 "Post-Event Report" feature.

---

**SaleDay Events**

Event Production Software

*Product Requirements & Development Plan*

*Salesability Canada Inc.   |   May 2026   |   CONFIDENTIAL*

# **Platform Overview**

The SaleDay Events Production Software is a next-generation platform designed to power the full lifecycle of automotive dealership sales events — from data ingestion and compliance scrubbing through campaign creation, launch, and real-time event management.

This platform sits above and integrates with the existing SaleDay Events scheduling app, adding the operational production layer that transforms a booked event into a fully executed, multi-channel marketing campaign.

The platform is designed to support up to 300 events per month across Canada, with full AI assistance for data cleaning, creative generation, and automated client communications.

# **Platform Architecture — Three Modules**

| Module 1 DataLoader *AI-assisted data ingestion, cleaning, compliance, and segmentation* | Module 2 Event Production Console *Campaign creation, scheduling, template management, and launch* | Module 3 Event Manager *Real-time event dashboard, communications console, and data viewer* |
| :---- | :---- | :---- |

| MODULE 1 DataLoader *AI-Assisted Data Ingestion, Cleaning, Compliance & Segmentation* |
| :---- |

## **Overview**

DataLoader is the data preparation engine for every sales event campaign. It accepts raw dealership data in multiple formats, applies AI-powered scrubbing and validation, enforces CASL and Do-Not-Call compliance, and outputs clean segmented data sets ready for each marketing channel.

All data is stored in event-specific buckets, enabling historical tracking of contacts, opt-outs, and campaign responses — ensuring clients are never over-marketed and compliance is always maintained.

## **Features & Capabilities**

| Feature | Description | AI |
| :---- | :---- | ----- |
| **Multi-Source Upload** | Accept data from dealer DMS, CSV, Excel, third-party lists, conquest data, service records, and CRM exports. Drag-and-drop interface. |  |
| **AI Data Scrubbing** | Automatically identify and correct formatting errors, duplicate records, invalid phone numbers, malformed emails, and incomplete addresses. | **🤖 AI** |
| **AI Data Cleaning** | Standardize name formats, phone formats, postal codes, and address fields. Fill missing data using AI inference where possible. | **🤖 AI** |
| **CASL Compliance Filter** | Cross-reference against CASL opt-out records. Flag and remove any contacts without valid express or implied consent. Compliance report generated per upload. |  |
| **Do-Not-Call Compliance** | Integrate with Canada's National Do Not Call Registry. Automatically scrub mobile and landline numbers before BDC call list generation. |  |
| **Historical Opt-Out Filter** | Store and apply opt-outs from all previous campaigns. Any contact who has opted out across any prior event is automatically excluded. |  |
| **Data Bucket Creation** | Each upload creates a named event data bucket. Buckets are stored per dealership per event for traceability and reuse. |  |
| **Channel Segmentation** | Automatically segment the cleaned data into separate output sets for each marketing channel: SMS, Email, Landing Page, Letter/Invite, BDC Call Sheets, Staff Call Sheets. | **🤖 AI** |
| **Deduplication** | Identify and merge duplicate contacts across channels. One person — one record — across all output sets. | **🤖 AI** |
| **Campaign History Filter** | Compare against previous campaign data. Flag contacts who have been contacted within a configurable window to reduce fatigue and opt-out rates. |  |
| **Data Summary Report** | Generate a compliance and data quality report for each upload: total records, removed records, opt-outs applied, channel breakdown, and quality score. |  |
| **Secure Storage** | All data stored encrypted. Access controlled by user role. Data retained per PIPEDA requirements and deleted on client request. |  |

## **Data Output Sets**

For each event, DataLoader produces the following ready-to-use data files:

* SMS Campaign List — mobile numbers, first name, postal code, opt-in confirmed

* Email Campaign List — email addresses, name, vehicle info, personalization fields

* Landing Page Registration List — full contact record for pre-population

* Letter / Postcard / Invitation List — full mailing address, formatted for mail merge

* BDC Call Sheets — name, phone, vehicle, service history, script notes

* Sales Staff Call Sheets — warm leads with appointment priority scoring

## **Compliance Architecture**

**DataLoader enforces a three-layer compliance model on every data set:**

| Layer | Regulation | Action |
| :---- | :---- | :---- |
| **Layer 1** | CASL — Canada's Anti-Spam Legislation | Remove contacts without valid consent. Log consent basis for every remaining contact. |
| **Layer 2** | DNCL — National Do Not Call List | Scrub all phone numbers against current DNCL registry before call list generation. |
| **Layer 3** | PIPEDA — Personal Information Protection | Dealer warrants consent per MSA. Salesability processes data per PIPEDA. Opt-outs stored permanently. |

| MODULE 2 Event Production Console *Campaign Creation, Scheduling, Template Management & Launch — up to 300 events/month* |
| :---- |

## **Overview**

The Event Production Console is the campaign command centre. It connects to the DataLoader buckets, enables creative selection and customization, schedules multi-channel campaign releases, and manages the full production workflow from briefing to launch.

The console is designed to support up to 300 events per month across multiple dealerships, with AI-assisted creative generation and a template library to accelerate production time.

## **Features & Capabilities**

| Feature | Description | AI |
| :---- | :---- | ----- |
| **Event Setup** | Create a new event production run linked to a scheduled SaleDay event. Pull event details (dealership, dates, coach, format) automatically from the scheduling app. |  |
| **Channel Selection** | Select which marketing channels to activate for each event: SMS, Email, Landing Page, BDC Call List, Sales Staff Call List, Letter, Postcard, Invitation. Each can be toggled independently. |  |
| **Data Bucket Attachment** | Attach the pre-cleaned DataLoader bucket for this event. System confirms record counts per channel before proceeding. |  |
| **AI Creative Generation** | Generate campaign copy for each channel using AI. Input: dealership name, event format, dates, offers. Output: SMS message, email subject/body, landing page copy, letter/invitation copy. | **🤖 AI** |
| **Template Library** | Store and reuse approved campaign templates. Templates organized by event type (VIP, Clearance, New Model, etc.) and channel. Full version history. |  |
| **Custom Campaign Builder** | Build custom campaigns from scratch using a drag-and-drop editor. Override AI suggestions with manual copy. Preview on all devices. | **🤖 AI** |
| **Personalization Variables** | Insert dynamic fields into all creative: {{first\_name}}, {{vehicle\_year}}, {{vehicle\_make}}, {{dealer\_name}}, {{event\_date}}, {{offer}}. |  |
| **Campaign Scheduling** | Set release dates and times for each channel independently. SMS Day 1, Email Day 2, BDC calls Day 1–3, Letters dispatched 10 days prior, etc. |  |
| **Campaign Calendar View** | Visual timeline showing all scheduled sends across all active events. Flag conflicts and capacity issues before launch. |  |
| **Previous Campaign Reference** | Before launch, system flags contacts in this data set who responded, opted out, or were previously contacted within the last 90 days. Recommend exclusions. | **🤖 AI** |
| **Launch Controls** | Staged launch workflow: Draft → Review → Approved → Scheduled → Live. Requires sign-off before any campaign goes live. |  |
| **Event Dashboard** | Summary card for each event: dealership, dates, channels active, record counts per channel, campaign status, scheduled send dates, and coach assignment. |  |
| **Production Capacity Monitor** | Real-time view of monthly production load. Alert when approaching 300-event capacity. Resource planning view by week. |  |
| **Third-Party Integration** | API connections to SMS platform (Twilio/Vonage), email platform (Mailchimp/Klaviyo/SendGrid), and print fulfillment for letters/postcards/invitations. |  |

## **Campaign Workflow**

Each event follows a structured production workflow from booking to launch:

| Step | Stage | Actions |
| ----- | :---- | :---- |
| **1** | **Event Created** | Event booked in SaleDay Events scheduling app. Production record auto-created in console. |
| **2** | **Data Upload** | Dealer uploads data. DataLoader cleans, scrubs, and segments into channel buckets. |
| **3** | **Campaign Setup** | User selects channels, attaches data bucket, confirms record counts per channel. |
| **4** | **Creative** | AI generates draft copy for each channel. User reviews, edits, and approves creative. |
| **5** | **Scheduling** | Release dates set for each channel. Timeline reviewed against campaign calendar. |
| **6** | **Review & Approval** | Campaign package reviewed. Sign-off required before scheduling locks. |
| **7** | **Launch** | Campaigns release automatically on scheduled dates. Real-time status dashboard updates. |
| **8** | **Monitoring** | Event Manager module takes over. Live stats, responses, and BDC results tracked. |

| MODULE 3 Event Manager *Real-Time Dashboard, Communications Console, Appointment Booking & Data Viewer* |
| :---- |

## **Overview**

The Event Manager is the live operations centre during a sales event. It gives the on-site team, sales coaches, and management real-time visibility into all event activity — appointments, inbound responses, BDC results, and marketing data — in one unified interface.

AI-powered SMS and email response consoles allow the team to handle inbound customer messages at scale, with smart suggested responses and automated follow-up sequences.

## **Features & Capabilities**

| Feature | Description | AI |
| :---- | :---- | ----- |
| **Real-Time Event Dashboard** | Live overview of all active event metrics: appointments booked, SMS responses, email opens/clicks, calls completed, leads in pipeline, and sales attributed. Updates in real time. |  |
| **Shareable Event Calendar** | Event-specific calendar shared with dealership staff showing scheduled appointments, team assignments, and event milestones. Staff can view on any device without login. |  |
| **Appointment Booking** | Online booking widget linked to each event. Customers click through from landing page, email, or SMS and book a time slot. Slots managed by sales team availability. |  |
| **SMS Console** | Centralized inbox for all inbound SMS responses. Conversation threads per customer. AI suggests reply based on message content and customer history. | **🤖 AI** |
| **AI SMS Response** | AI drafts context-aware replies to customer SMS messages. Handles common responses: "interested", "what time", "not interested", "already bought". Human reviews before sending. | **🤖 AI** |
| **Email Console** | Centralized inbox for email replies. Threaded view per customer. AI generates response drafts matched to tone and inquiry type. | **🤖 AI** |
| **AI Email Response** | AI drafts professional email replies for common scenarios. Customizable tone (formal/friendly). Auto-flag urgent replies for immediate human attention. | **🤖 AI** |
| **BDC Call Uploader** | BDC team uploads call results at end of each session. Records: calls made, contacts reached, voicemails left, appointments booked, and call notes per contact. |  |
| **BDC Management** | Track BDC team performance across the event: calls per hour, contact rate, appointment conversion rate. Compare against benchmarks. |  |
| **BDC Results Dashboard** | Summary of all BDC activity: total calls, contacts reached, appointments booked, and no-answers. Exportable for post-event reporting. |  |
| **Data Viewer** | Full view of all contacts who received marketing for this event. Filter by channel, status (responded/opted-out/no response), and appointment status. Search by name, phone, or email. |  |
| **Traffic Cop Integration** | Connect to the dealership's showroom traffic management system. Receive real-time walk-in data. Match walk-ins to marketed contacts to measure campaign attribution. |  |
| **Post-Event Report** | Auto-generated event summary report: marketing sent, response rates, appointments booked, walk-ins, sales attributed, opt-outs generated. Shareable PDF. | **🤖 AI** |

## **AI Response Console — How It Works**

The SMS and Email AI response engines follow a three-step workflow to ensure accuracy and control:

* Step 1 — Customer sends inbound message (SMS reply or email)

* Step 2 — AI analyzes message intent, cross-references customer record (vehicle, history, appointment status)

* Step 3 — AI drafts a personalized reply and presents it to the team member for review

* Step 4 — Team member approves, edits, or discards the draft with one click

* Step 5 — Response sent. Conversation logged to customer record.

*AI learns from approved and rejected responses over time, improving suggestion quality with each event.*

## **Traffic Cop Integration**

Traffic Cop is a dealership showroom management tool that tracks customer walk-ins, greetings, and floor activity. Integration with Event Manager enables:

* Real-time walk-in counter on the event dashboard

* Match walk-ins to customers in the marketed data set

* Attribution report: which channel drove each walk-in

* Sales team activity tracking during the event

* Post-event ROI calculation per marketing channel

# **Integration Architecture**

The three modules work together as an integrated platform, with data flowing from DataLoader through the Production Console into the Event Manager:

| Integration | From | To |
| :---- | :---- | :---- |
| **Event Data** | SaleDay Events Scheduling App | DataLoader \+ Production Console |
| **Cleaned Data Buckets** | DataLoader | Production Console (channel sets) |
| **Campaign Assets** | Production Console | SMS / Email / Print providers |
| **Campaign Status** | SMS / Email platforms | Event Manager dashboard |
| **BDC Results** | BDC team upload | Event Manager \+ DataLoader history |
| **Walk-In Data** | Traffic Cop API | Event Manager dashboard |
| **Opt-Outs** | All channels \+ BDC | DataLoader suppression list |
| **Post-Event Report** | Event Manager | SaleDay Events scheduling app \+ email |

# **Recommended Technology Stack**

| Component | Recommendation | Rationale |
| :---- | :---- | :---- |
| **Frontend Framework** | React \+ TypeScript | Component-based UI suits complex dashboards and consoles |
| **Backend / API** | Node.js \+ Express or Next.js | JavaScript full-stack, fast development, serverless-friendly |
| **Database** | PostgreSQL (Supabase) | Relational data for compliance records, free tier available |
| **File Storage** | AWS S3 or Supabase Storage | Secure storage for data uploads and campaign assets |
| **AI Engine** | Anthropic Claude API | Best-in-class for creative copy and data analysis tasks |
| **SMS Platform** | Twilio or Vonage | Canadian carrier coverage, two-way messaging, CASL tools |
| **Email Platform** | Sendgrid or Klaviyo | High deliverability, personalization, analytics |
| **Authentication** | Supabase Auth or Auth0 | Role-based access for admin, coach, BDC, dealer |
| **Hosting** | Vercel or AWS | Scalable, serverless, CDN-optimized |
| **Print Fulfillment** | TBD — Canada Post / partner | Letter, postcard, and invitation production |
| **Traffic Cop** | API integration | Requires Traffic Cop API credentials from dealer |

# **Development Phases & Estimates**

| Phase | Scope | Modules | Est. Duration |
| ----- | :---- | :---- | :---- |
| **Phase 1** | Foundation — Auth, database schema, data upload, basic cleaning | DataLoader (core) | **6–8 weeks** |
| **Phase 2** | Compliance engine — CASL/DNCL scrubbing, opt-out management, channel segmentation | DataLoader (compliance) | **4–6 weeks** |
| **Phase 3** | Campaign console — event setup, channel selection, scheduling, template library | Production Console (core) | **8–10 weeks** |
| **Phase 4** | AI creative — copy generation, personalization, custom campaign builder | Production Console (AI) | **4–6 weeks** |
| **Phase 5** | Event dashboard — real-time metrics, shareable calendar, appointment booking | Event Manager (core) | **6–8 weeks** |
| **Phase 6** | Communications consoles — SMS \+ email with AI response engine | Event Manager (AI) | **6–8 weeks** |
| **Phase 7** | BDC management, data viewer, Traffic Cop integration | Event Manager (advanced) | **4–6 weeks** |
| **Phase 8** | Reporting, post-event automation, full platform integration | All modules | **4–6 weeks** |

*Total estimated development timeline: 42–58 weeks (full platform). Phases can be prioritized and deployed independently based on business need and budget.*

# **Key Considerations**

* CASL and DNCL compliance must be built into the platform architecture from day one — not added later

* Data security and encryption are critical given the volume and sensitivity of personal information handled

* The platform must support multi-tenancy — each dealership's data must be completely isolated

* AI components should always include human review before any customer-facing send

* Traffic Cop integration depends on dealership participation and API availability

* Print fulfillment partner selection will impact letter/invitation lead times and per-unit costs

* Scalability to 300 events/month requires careful architecture of the campaign scheduling engine

* Opt-out data must be stored permanently and applied across all future campaigns for all clients

*This document is proprietary and confidential. Prepared by Salesability Canada Inc. — May 2026.*

*Developed with Claude AI (Anthropic)*
