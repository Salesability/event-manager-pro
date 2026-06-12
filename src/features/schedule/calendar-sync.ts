import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  campaignStyles,
  campaigns,
  contactIdentifiers,
  contacts,
  dealers,
} from '@/lib/db/schema';
import {
  GoogleCalendarError,
  createEvent,
  deleteEvent,
  googleCalendarConfigured,
  patchEvent,
} from '@/lib/google/calendar';
import { coachGcalColorId, mapCampaignToGcalEvent } from '@/lib/google/calendar-event';
import { siteUrl } from '@/lib/url';

// Best-effort projection of a campaign into Google Calendar (chunk 0077,
// Phase 4). The app is the source of truth and is NEVER blocked by a Google
// failure (decision.md §6): every entry point swallows errors, marks the row
// `failed`, and lets the campaign mutation succeed. `reconcileCampaignCalendar`
// is the single status-driven entry point — booked/completed campaigns get an
// upserted event (create→backfill `gcal_event_id` / patch the linked one,
// mirroring the QBO push idempotency), cancelled/draft campaigns have their
// event removed. Coach + dealer ride as guests; the description is customer-safe
// by construction (the mapper only sees safe fields).

export type CalendarSyncOutcome = 'synced' | 'removed' | 'failed' | 'skipped' | 'missing';

// Accept either the app pool or a transaction so the integration test can drive
// reconcile inside a rolled-back tx (cf. quote-push.ts). Server Actions call
// with the default (the app pool) — reconcile runs after their own tx commits.
type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// One-shot read of everything the mapper needs: the campaign, its dealer, the
// coach (name + primary email, joined from contact_identifiers), and the format
// label. Coach colour is derived, not stored (decision.md §7).
async function loadCampaignSyncInput(campaignId: number, exec: Executor) {
  const [row] = await exec
    .select({
      id: campaigns.id,
      publicId: campaigns.publicId,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      contact: campaigns.contact,
      phone: campaigns.phone,
      email: campaigns.email,
      gcalEventId: campaigns.gcalEventId,
      styleLabel: campaignStyles.label,
      dealerName: dealers.name,
      dealerAddress: dealers.address,
      coachId: campaigns.coachId,
      coachFirstName: contacts.firstName,
      coachLastName: contacts.lastName,
      coachEmail: contactIdentifiers.value,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .leftJoin(contacts, eq(contacts.id, campaigns.coachId))
    .leftJoin(campaignStyles, eq(campaignStyles.id, campaigns.styleId))
    // The coach's primary email (the partial-unique primary index makes this 1:1).
    // The join key is the campaign's coachId, so it's NULL-safe when no coach is set.
    .leftJoin(
      contactIdentifiers,
      and(
        eq(contactIdentifiers.contactId, campaigns.coachId),
        eq(contactIdentifiers.kind, 'email'),
        eq(contactIdentifiers.isPrimary, true),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row ?? null;
}

async function markFailed(campaignId: number, userId: string, exec: Executor) {
  await exec
    .update(campaigns)
    .set({ gcalSyncStatus: 'failed', updatedById: userId })
    .where(eq(campaigns.id, campaignId));
}

// Reconcile one campaign's calendar event to match its current state. Always
// best-effort: returns an outcome, NEVER throws (the whole body — including the
// DB read — is inside the try). `skipped` = Google/SITE_URL unconfigured (status
// untouched); `missing` = no such campaign; `failed` = a Google/DB error (status
// marked `failed`).
export async function reconcileCampaignCalendar(
  campaignId: number,
  userId: string,
  exec: Executor = db,
): Promise<CalendarSyncOutcome> {
  if (!googleCalendarConfigured()) return 'skipped';
  let appLink: string;
  try {
    appLink = siteUrl('/calendar'); // no per-campaign route yet — link to the schedule
  } catch {
    return 'skipped'; // SITE_URL unset → can't build an absolute event link
  }

  try {
    const row = await loadCampaignSyncInput(campaignId, exec);
    if (!row) return 'missing';

    // booked/completed → the calendar should carry an event; draft/cancelled → none.
    const wantsEvent = row.status === 'booked' || row.status === 'completed';
    if (!wantsEvent) {
      if (row.gcalEventId) {
        await deleteEvent(row.gcalEventId); // idempotent: a 404/410 counts as removed
      }
      await exec
        .update(campaigns)
        .set({
          gcalEventId: null,
          gcalSyncStatus: 'synced',
          gcalSyncedAt: new Date(),
          updatedById: userId,
        })
        .where(eq(campaigns.id, campaignId));
      return 'removed';
    }

    const coachName =
      row.coachFirstName || row.coachLastName
        ? `${row.coachFirstName ?? ''} ${row.coachLastName ?? ''}`.trim()
        : null;
    const event = mapCampaignToGcalEvent(
      {
        id: row.id,
        publicId: row.publicId,
        startDate: row.startDate,
        endDate: row.endDate,
        styleLabel: row.styleLabel,
        contact: row.contact,
        phone: row.phone,
        email: row.email,
      },
      { name: row.dealerName, address: row.dealerAddress },
      {
        name: coachName,
        email: row.coachEmail ?? null,
        colorId: row.coachId != null ? coachGcalColorId(row.coachId) : null,
      },
      appLink,
    );

    // Try to patch the linked event. If Google says it's gone (deleted
    // out-of-band → 404/410), clear the stale link and fall through to recreate
    // — so a re-sync is a real recovery path rather than failing forever.
    let needsCreate = !row.gcalEventId;
    if (row.gcalEventId) {
      try {
        await patchEvent(row.gcalEventId, event);
        await exec
          .update(campaigns)
          .set({ gcalSyncStatus: 'synced', gcalSyncedAt: new Date(), updatedById: userId })
          .where(eq(campaigns.id, campaignId));
      } catch (err) {
        if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) {
          // Clear the link ONLY if it's still the stale id we observed (CAS) — a
          // concurrent reconcile may have already relinked it to a fresh event,
          // in which case we must NOT clear+recreate (that would null its valid
          // link and duplicate the Google event). Lost race → leave it synced.
          const cleared = await exec
            .update(campaigns)
            .set({ gcalEventId: null })
            .where(and(eq(campaigns.id, campaignId), eq(campaigns.gcalEventId, row.gcalEventId)))
            .returning({ id: campaigns.id });
          needsCreate = cleared.length > 0;
        } else {
          throw err; // a real failure → outer catch marks `failed`
        }
      }
    }

    if (needsCreate) {
      const created = await createEvent(event);
      // Guarded backfill (mirrors the QBO push): a concurrent reconcile that
      // already linked this campaign wins. The event was sent BEFORE the durable
      // link is stored, so a backfill exception (or a lost race) must clean the
      // event up, else it orphans in Google and the next sync sends a duplicate.
      let linked: { id: number }[];
      try {
        linked = await exec
          .update(campaigns)
          .set({
            gcalEventId: created.id,
            gcalSyncStatus: 'synced',
            gcalSyncedAt: new Date(),
            updatedById: userId,
          })
          .where(and(eq(campaigns.id, campaignId), isNull(campaigns.gcalEventId)))
          .returning({ id: campaigns.id });
      } catch (dbErr) {
        await deleteEvent(created.id).catch(() => {}); // don't orphan the event
        throw dbErr;
      }
      if (!linked.length) {
        await deleteEvent(created.id).catch(() => {});
      }
    }
    return 'synced';
  } catch (err) {
    console.error(`[calendar-sync] campaign ${campaignId} sync failed:`, err);
    await markFailed(campaignId, userId, exec).catch(() => {});
    return 'failed';
  }
}
