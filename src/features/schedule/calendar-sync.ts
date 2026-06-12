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

export type CalendarSyncOutcome = 'synced' | 'removed' | 'failed' | 'skipped';

// One-shot read of everything the mapper needs: the campaign, its dealer, the
// coach (name + primary email, joined from contact_identifiers), and the format
// label. Coach colour is derived, not stored (decision.md §7).
async function loadCampaignSyncInput(campaignId: number) {
  const [row] = await db
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

async function markFailed(campaignId: number, userId: string) {
  await db
    .update(campaigns)
    .set({ gcalSyncStatus: 'failed', updatedById: userId })
    .where(eq(campaigns.id, campaignId));
}

// Reconcile one campaign's calendar event to match its current state. Always
// best-effort: returns an outcome, never throws. `skipped` = Google isn't
// configured (or no SITE_URL to build links / row gone), so the row's status is
// left untouched.
export async function reconcileCampaignCalendar(
  campaignId: number,
  userId: string,
): Promise<CalendarSyncOutcome> {
  if (!googleCalendarConfigured()) return 'skipped';
  let appLink: string;
  try {
    appLink = siteUrl('/calendar'); // no per-campaign route yet — link to the schedule
  } catch {
    return 'skipped'; // SITE_URL unset → can't build an absolute event link
  }

  const row = await loadCampaignSyncInput(campaignId);
  if (!row) return 'skipped';

  // booked/completed → the calendar should carry an event; draft/cancelled → none.
  const wantsEvent = row.status === 'booked' || row.status === 'completed';

  try {
    if (!wantsEvent) {
      if (row.gcalEventId) {
        await deleteEvent(row.gcalEventId); // idempotent: a 404/410 counts as removed
      }
      await db
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

    if (row.gcalEventId) {
      await patchEvent(row.gcalEventId, event);
      await db
        .update(campaigns)
        .set({ gcalSyncStatus: 'synced', gcalSyncedAt: new Date(), updatedById: userId })
        .where(eq(campaigns.id, campaignId));
    } else {
      const created = await createEvent(event);
      // Guarded backfill (mirrors the QBO push): a concurrent reconcile that
      // already linked this campaign wins; our freshly-created event would be a
      // duplicate invite, so best-effort delete it to keep one event per campaign.
      const linked = await db
        .update(campaigns)
        .set({
          gcalEventId: created.id,
          gcalSyncStatus: 'synced',
          gcalSyncedAt: new Date(),
          updatedById: userId,
        })
        .where(and(eq(campaigns.id, campaignId), isNull(campaigns.gcalEventId)))
        .returning({ id: campaigns.id });
      if (!linked.length) {
        await deleteEvent(created.id).catch(() => {});
      }
    }
    return 'synced';
  } catch (err) {
    console.error(`[calendar-sync] campaign ${campaignId} sync failed:`, err);
    await markFailed(campaignId, userId).catch(() => {});
    return 'failed';
  }
}
