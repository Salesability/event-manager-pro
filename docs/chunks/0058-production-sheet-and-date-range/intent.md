# Production List: Shareable Google Sheet + Date-Range View — Intent

**Created:** 2026-05-21

## Problem

The Production list (`src/app/(app)/production/production-admin.tsx`) is an in-app `<DataTable>` with a search box, an "upcoming/past" status filter (`:128-139`), a show-cancelled toggle, and CSV export / print. The owner wants two things: (1) the production list available as a **link to a shareable Google Sheet** so it can be handed to people who live in Sheets, and (2) a **date-range option — 1 month / 2 month / 3 month** — in the dropdown alongside upcoming/past, so the view can be scoped to a near horizon instead of all-time.

## Desired outcome

- The production page surfaces a **shareable Google Sheet** reflecting the production list, with a link the owner can open/share. (Whether it's a one-click export-to-Sheet or a kept-in-sync sheet is an open question below.)
- The existing upcoming/past dropdown gains **1 month / 2 month / 3 month** range choices that scope the list to events within that window.

## Non-goals

- **No two-way sync** (editing the Sheet does not write back to the app).
- **No replacement** of the existing CSV export / print — those stay.
- **No new production data model** — the date-range filter is a query-level scope over existing campaign dates.

## Success criteria

- A "1 month / 2 month / 3 month" option set is available in the production filter dropdown and correctly scopes rows by event date relative to today.
- A Google Sheet representing the production list is reachable from the production page via a shareable link.
- The Sheet's contents match the current production export columns.
- Sheet sharing/permissions are set so the owner's intended audience can open it.

## Open questions

- **Sheet model:** one-click "export to a new Sheet (returns a link)" vs. a single canonical Sheet refreshed on demand vs. a scheduled sync? (Leaning: on-demand export-to-Sheet returning a shareable link — simplest, mirrors the existing CSV export route.)
- **Google auth:** a **service account** (sheet owned by an app identity, shared out) vs. the signed-in user's Google OAuth (the app already uses Google sign-in)? Service account is more predictable for sharing; needs a secret + Drive/Sheets API enablement. **No active Sheets API client exists today** — only a legacy one-time `scripts/import-from-sheets.ts` and GCS for PDFs.
- **Date-range semantics:** does "1 month" mean next 30 days forward (upcoming) or a rolling ±window? Does it combine with upcoming/past or replace it? (Leaning: forward window from today, replacing the upcoming/past selection.)
- **Sharing scope:** anyone-with-link vs. specific emails? Owner to confirm.

## Why now

The owner wants to hand the production schedule to Sheets-native collaborators and to focus the in-app view on a near horizon during busy booking periods. The CSV export route (`src/app/(app)/production/export/route.ts`) is a ready model for the Sheet export's column shape.
