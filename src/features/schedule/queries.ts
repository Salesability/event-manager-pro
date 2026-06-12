import 'server-only';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { formatYearMonth } from '@/lib/dates';
import type { CaProvinceCode } from '@/lib/ca-provinces';
import {
  availabilityBlocks,
  billingAdjustments,
  campaigns,
  campaignStyles,
  contactIdentifiers,
  contacts,
  dealerContacts,
  dealers,
  audienceSources,
  teamMemberRoles,
} from '@/lib/db/schema';

export type Dealer = {
  id: number;
  publicId: string;
  name: string;
  address: string | null;
  /** CA province/territory, or null if not yet set. Drives quote sales tax (0065). */
  province: CaProvinceCode | null;
  status: 'prospect' | 'active';
  acquiredVia: string | null;
  /** ISO timestamp when archived, else null. Surfaced for the /dealerships
   *  filter pills (Active / Prospect / Archived). Other surfaces (calendar,
   *  production, admin/people) get only non-archived dealers via `loadDealers`. */
  archivedAt: Date | null;
  contactId: number | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
};

export type Coach = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  specialty: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
};

export type Campaign = {
  id: number;
  publicId: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'booked' | 'cancelled' | 'completed';
  dealerId: number;
  dealerName: string;
  dealerAddress: string | null;
  coachId: number | null;
  coachName: string | null;
  styleId: number | null;
  styleLabel: string | null;
  audienceSourceId: number | null;
  audienceSourceLabel: string | null;
  qtyRecords: number | null;
  smsEmail: number | null;
  letters: number | null;
  bdc: number | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  // Google Calendar projection state (0077). `gcalSyncStatus` drives the
  // event-detail "Calendar" badge + the manual re-sync affordance.
  gcalSyncStatus: 'pending' | 'synced' | 'failed';
  gcalEventId: string | null;
};

// 0059: billing-adjustment overlay on the /reports surface. `BillingField`
// values mirror the campaign columns they override; `CAMPAIGN_FIELD_BY_BILLING`
// maps each back to its `Campaign` key so callers can read the original value.
export type BillingField = 'qty_records' | 'sms_email' | 'letters' | 'bdc';

export const BILLING_FIELDS: readonly BillingField[] = [
  'qty_records',
  'sms_email',
  'letters',
  'bdc',
] as const;

export const CAMPAIGN_FIELD_BY_BILLING: Record<BillingField, keyof Campaign> = {
  qty_records: 'qtyRecords',
  sms_email: 'smsEmail',
  letters: 'letters',
  bdc: 'bdc',
};

/** Persisted billing overrides for one campaign, keyed by field. An absent
 *  key means "no override — use the campaign's own value." */
export type CampaignBillingOverrides = Partial<Record<BillingField, number>>;

/** A Full-Production-Report row: a campaign plus its billing overlay. The
 *  original campaign columns stay on the row (recoverable); `billing` carries
 *  the admin's adjustments so the UI can show effective + original together. */
export type FullReportCampaign = Campaign & { billing: CampaignBillingOverrides };

export type LookupOption = {
  id: number;
  label: string;
};

export type AvailabilityBlock = {
  id: number;
  startDate: string;
  endDate: string;
  kind: 'statutory_holiday' | 'company_closure' | 'coach_unavailable';
  coachId: number | null;
  reason: string | null;
};

// dealer_contact_role priority for "primary contact" display: a dealer can have
// several active links (staff, customer, prospect); pick whichever is most
// authoritative. Importer wrote 'customer' for legacy Contact Person rows; the
// new CRUD writes 'staff'. Reads accept either so already-imported dealers
// don't lose their contact info on the Lists view.
const DEALER_CONTACT_ROLE_PRIORITY = { staff: 0, customer: 1, prospect: 2 } as const;

async function fetchPrimaryDealerContacts(dealerIds: number[]) {
  if (!dealerIds.length) return new Map<number, { contactId: number; firstName: string; lastName: string }>();

  const links = await db
    .select({
      dealerId: dealerContacts.dealerId,
      role: dealerContacts.role,
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      linkId: dealerContacts.id,
    })
    .from(dealerContacts)
    .innerJoin(contacts, eq(contacts.id, dealerContacts.contactId))
    .where(
      and(
        inArray(dealerContacts.dealerId, dealerIds),
        isNull(dealerContacts.archivedAt),
        isNull(contacts.archivedAt)
      )
    )
    .orderBy(asc(dealerContacts.dealerId), asc(dealerContacts.id));

  const byDealer = new Map<
    number,
    { contactId: number; firstName: string; lastName: string; rolePriority: number }
  >();
  for (const link of links) {
    const priority = DEALER_CONTACT_ROLE_PRIORITY[link.role];
    const current = byDealer.get(link.dealerId);
    if (!current || priority < current.rolePriority) {
      byDealer.set(link.dealerId, {
        contactId: link.contactId,
        firstName: link.firstName,
        lastName: link.lastName,
        rolePriority: priority,
      });
    }
  }
  return byDealer;
}

async function fetchPrimaryIdentifiers(contactIds: number[]) {
  if (!contactIds.length)
    return new Map<number, { email: string | null; phone: string | null }>();

  const idents = await db
    .select({
      contactId: contactIdentifiers.contactId,
      kind: contactIdentifiers.kind,
      value: contactIdentifiers.value,
      isPrimary: contactIdentifiers.isPrimary,
    })
    .from(contactIdentifiers)
    .where(
      and(
        inArray(contactIdentifiers.contactId, contactIds),
        isNull(contactIdentifiers.archivedAt)
      )
    );

  const map = new Map<number, { email: string | null; phone: string | null }>();
  for (const ident of idents) {
    let entry = map.get(ident.contactId);
    if (!entry) {
      entry = { email: null, phone: null };
      map.set(ident.contactId, entry);
    }
    if (ident.kind === 'email') {
      if (ident.isPrimary || !entry.email) entry.email = ident.value;
    } else if (ident.kind === 'phone') {
      if (ident.isPrimary || !entry.phone) entry.phone = ident.value;
    }
  }
  return map;
}

async function loadDealersInner(opts: { includeArchived: boolean }): Promise<Dealer[]> {
  const rows = await db
    .select({
      id: dealers.id,
      publicId: dealers.publicId,
      name: dealers.name,
      address: dealers.address,
      province: dealers.province,
      status: dealers.status,
      acquiredVia: dealers.acquiredVia,
      archivedAt: dealers.archivedAt,
    })
    .from(dealers)
    .where(opts.includeArchived ? undefined : isNull(dealers.archivedAt))
    .orderBy(dealers.name);

  const dealerIds = rows.map((r) => r.id);
  const primaryContacts = await fetchPrimaryDealerContacts(dealerIds);
  const idents = await fetchPrimaryIdentifiers(
    Array.from(primaryContacts.values(), (v) => v.contactId)
  );

  return rows.map((r) => {
    const link = primaryContacts.get(r.id);
    const ident = link ? idents.get(link.contactId) : undefined;
    return {
      id: r.id,
      publicId: r.publicId,
      name: r.name,
      address: r.address,
      province: r.province,
      status: r.status,
      acquiredVia: r.acquiredVia,
      archivedAt: r.archivedAt,
      contactId: link?.contactId ?? null,
      contactFirstName: link?.firstName ?? null,
      contactLastName: link?.lastName ?? null,
      primaryEmail: ident?.email ?? null,
      primaryPhone: ident?.phone ?? null,
    };
  });
}

export async function loadDealers(): Promise<Dealer[]> {
  // Non-archived only — calendar / production / people pickers want a live
  // dealer list, not a historical roster.
  return loadDealersInner({ includeArchived: false });
}

// /dealerships filter pills surface archived rows too. Archived =
// `archived_at IS NOT NULL` (independent of `status`, per 0035 plan OQ #1).
export async function loadDealersIncludingArchived(): Promise<Dealer[]> {
  return loadDealersInner({ includeArchived: true });
}

// Single-dealer loader carries `quickbooksId` (0070) on top of the shared
// `Dealer` shape — the dealer detail page renders the QB link state from it and
// the "Push to QuickBooks" action reads it to decide create-vs-update. The
// list loaders don't need it, so it stays off the base `Dealer` type.
export async function loadDealer(
  id: number,
): Promise<(Dealer & { quickbooksId: string | null }) | null> {
  const [row] = await db
    .select({
      id: dealers.id,
      publicId: dealers.publicId,
      name: dealers.name,
      address: dealers.address,
      province: dealers.province,
      status: dealers.status,
      acquiredVia: dealers.acquiredVia,
      archivedAt: dealers.archivedAt,
      quickbooksId: dealers.quickbooksId,
    })
    .from(dealers)
    .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)))
    .limit(1);
  if (!row) return null;

  const primaryContacts = await fetchPrimaryDealerContacts([row.id]);
  const link = primaryContacts.get(row.id);
  const idents = await fetchPrimaryIdentifiers(link ? [link.contactId] : []);
  const ident = link ? idents.get(link.contactId) : undefined;

  return {
    id: row.id,
    publicId: row.publicId,
    name: row.name,
    address: row.address,
    province: row.province,
    status: row.status,
    acquiredVia: row.acquiredVia,
    archivedAt: row.archivedAt,
    quickbooksId: row.quickbooksId,
    contactId: link?.contactId ?? null,
    contactFirstName: link?.firstName ?? null,
    contactLastName: link?.lastName ?? null,
    primaryEmail: ident?.email ?? null,
    primaryPhone: ident?.phone ?? null,
  };
}

export async function loadCoaches(): Promise<Coach[]> {
  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      displayName: contacts.displayName,
      specialty: teamMemberRoles.specialty,
    })
    .from(contacts)
    .innerJoin(
      teamMemberRoles,
      and(
        eq(teamMemberRoles.contactId, contacts.id),
        eq(teamMemberRoles.role, 'coach'),
        isNull(teamMemberRoles.archivedAt)
      )
    )
    .where(isNull(contacts.archivedAt))
    .orderBy(contacts.firstName, contacts.lastName);

  if (!rows.length) return [];

  const coachIds = rows.map((r) => r.id);
  const idents = await db
    .select({
      contactId: contactIdentifiers.contactId,
      kind: contactIdentifiers.kind,
      value: contactIdentifiers.value,
      isPrimary: contactIdentifiers.isPrimary,
    })
    .from(contactIdentifiers)
    .where(
      and(
        inArray(contactIdentifiers.contactId, coachIds),
        isNull(contactIdentifiers.archivedAt)
      )
    );

  const primaryByContact = new Map<number, { email: string | null; phone: string | null }>();
  for (const ident of idents) {
    let entry = primaryByContact.get(ident.contactId);
    if (!entry) {
      entry = { email: null, phone: null };
      primaryByContact.set(ident.contactId, entry);
    }
    if (ident.kind === 'email') {
      if (ident.isPrimary || !entry.email) entry.email = ident.value;
    } else if (ident.kind === 'phone') {
      if (ident.isPrimary || !entry.phone) entry.phone = ident.value;
    }
  }

  return rows.map((r) => {
    const ident = primaryByContact.get(r.id);
    return {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      displayName: r.displayName,
      specialty: r.specialty,
      primaryEmail: ident?.email ?? null,
      primaryPhone: ident?.phone ?? null,
    };
  });
}

export async function loadCoach(id: number): Promise<Coach | null> {
  const [row] = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      displayName: contacts.displayName,
      specialty: teamMemberRoles.specialty,
    })
    .from(contacts)
    .innerJoin(
      teamMemberRoles,
      and(
        eq(teamMemberRoles.contactId, contacts.id),
        eq(teamMemberRoles.role, 'coach'),
        isNull(teamMemberRoles.archivedAt)
      )
    )
    .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
    .limit(1);
  if (!row) return null;

  const idents = await fetchPrimaryIdentifiers([row.id]);
  const ident = idents.get(row.id);
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    specialty: row.specialty,
    primaryEmail: ident?.email ?? null,
    primaryPhone: ident?.phone ?? null,
  };
}

export async function loadCampaigns(): Promise<Campaign[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      publicId: campaigns.publicId,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      status: campaigns.status,
      dealerId: campaigns.dealerId,
      dealerName: dealers.name,
      dealerAddress: dealers.address,
      coachId: campaigns.coachId,
      coachFirstName: contacts.firstName,
      coachLastName: contacts.lastName,
      styleId: campaigns.styleId,
      styleLabel: campaignStyles.label,
      audienceSourceId: campaigns.audienceSourceId,
      audienceSourceLabel: audienceSources.label,
      qtyRecords: campaigns.qtyRecords,
      smsEmail: campaigns.smsEmail,
      letters: campaigns.letters,
      bdc: campaigns.bdc,
      contact: campaigns.contact,
      phone: campaigns.phone,
      email: campaigns.email,
      notes: campaigns.notes,
      gcalSyncStatus: campaigns.gcalSyncStatus,
      gcalEventId: campaigns.gcalEventId,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .leftJoin(contacts, eq(contacts.id, campaigns.coachId))
    .leftJoin(campaignStyles, eq(campaignStyles.id, campaigns.styleId))
    .leftJoin(audienceSources, eq(audienceSources.id, campaigns.audienceSourceId))
    .orderBy(campaigns.startDate);

  return rows.map((r) => ({
    id: r.id,
    publicId: r.publicId,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
    dealerId: r.dealerId,
    dealerName: r.dealerName,
    dealerAddress: r.dealerAddress,
    coachId: r.coachId,
    coachName:
      r.coachFirstName || r.coachLastName
        ? `${r.coachFirstName ?? ''} ${r.coachLastName ?? ''}`.trim()
        : null,
    styleId: r.styleId,
    styleLabel: r.styleLabel,
    audienceSourceId: r.audienceSourceId,
    audienceSourceLabel: r.audienceSourceLabel,
    qtyRecords: r.qtyRecords,
    smsEmail: r.smsEmail,
    letters: r.letters,
    bdc: r.bdc,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    gcalSyncStatus: r.gcalSyncStatus,
    gcalEventId: r.gcalEventId,
  }));
}

export async function loadCampaign(id: number): Promise<Campaign | null> {
  const [row] = await db
    .select({
      id: campaigns.id,
      publicId: campaigns.publicId,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      status: campaigns.status,
      dealerId: campaigns.dealerId,
      dealerName: dealers.name,
      dealerAddress: dealers.address,
      coachId: campaigns.coachId,
      coachFirstName: contacts.firstName,
      coachLastName: contacts.lastName,
      styleId: campaigns.styleId,
      styleLabel: campaignStyles.label,
      audienceSourceId: campaigns.audienceSourceId,
      audienceSourceLabel: audienceSources.label,
      qtyRecords: campaigns.qtyRecords,
      smsEmail: campaigns.smsEmail,
      letters: campaigns.letters,
      bdc: campaigns.bdc,
      contact: campaigns.contact,
      phone: campaigns.phone,
      email: campaigns.email,
      notes: campaigns.notes,
      gcalSyncStatus: campaigns.gcalSyncStatus,
      gcalEventId: campaigns.gcalEventId,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .leftJoin(contacts, eq(contacts.id, campaigns.coachId))
    .leftJoin(campaignStyles, eq(campaignStyles.id, campaigns.styleId))
    .leftJoin(audienceSources, eq(audienceSources.id, campaigns.audienceSourceId))
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.publicId,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    dealerId: row.dealerId,
    dealerName: row.dealerName,
    dealerAddress: row.dealerAddress,
    coachId: row.coachId,
    coachName:
      row.coachFirstName || row.coachLastName
        ? `${row.coachFirstName ?? ''} ${row.coachLastName ?? ''}`.trim()
        : null,
    styleId: row.styleId,
    styleLabel: row.styleLabel,
    audienceSourceId: row.audienceSourceId,
    audienceSourceLabel: row.audienceSourceLabel,
    qtyRecords: row.qtyRecords,
    smsEmail: row.smsEmail,
    letters: row.letters,
    bdc: row.bdc,
    contact: row.contact,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    gcalSyncStatus: row.gcalSyncStatus,
    gcalEventId: row.gcalEventId,
  };
}

export async function loadCampaignStyles(): Promise<LookupOption[]> {
  return db
    .select({ id: campaignStyles.id, label: campaignStyles.label })
    .from(campaignStyles)
    .where(isNull(campaignStyles.archivedAt))
    .orderBy(campaignStyles.sortOrder, campaignStyles.label);
}

export async function loadAudienceSources(): Promise<LookupOption[]> {
  return db
    .select({ id: audienceSources.id, label: audienceSources.label })
    .from(audienceSources)
    .where(isNull(audienceSources.archivedAt))
    .orderBy(audienceSources.sortOrder, audienceSources.label);
}

// Shared shape for the three group-by aggregations on the /reports surface.
// `groupKey` is the GROUP BY column value (dealerId, coachId, or 'YYYY-MM');
// `groupLabel` is what the table renders. `count` and the three totals are
// cast to int in SQL — Postgres returns bigint for `count()` / `sum()`, which
// drizzle hands back as a string by default.
export type CampaignAggregateRow<K = number | null | string> = {
  groupKey: K;
  groupLabel: string;
  count: number;
  totalQty: number;
  totalSms: number;
  totalLetters: number;
};

// 0059: per-campaign pivot of billing_adjustments — one row per campaign with
// the effective override (or NULL) for each summed field. LEFT-joined into the
// three aggregate loaders so totals read `coalesce(override, campaign.value)`.
// Each campaign has at most one adjustment per field (unique constraint), so
// `max(value) filter (...)` collapses to that field's override or NULL.
function billingPivotSubquery() {
  return db
    .select({
      campaignId: billingAdjustments.campaignId,
      // 0061: alias these `adj_*` so they don't collide with the same-named
      // `campaigns` columns (`letters`) when interpolated unqualified into the
      // outer `coalesce(...)` — a bare `letters` is ambiguous (Postgres 42702).
      adjRecords: sql<
        number | null
      >`max(${billingAdjustments.value}) filter (where ${billingAdjustments.field} = 'qty_records')`.as(
        'adj_records',
      ),
      adjSms: sql<
        number | null
      >`max(${billingAdjustments.value}) filter (where ${billingAdjustments.field} = 'sms_email')`.as(
        'adj_sms',
      ),
      adjLetters: sql<
        number | null
      >`max(${billingAdjustments.value}) filter (where ${billingAdjustments.field} = 'letters')`.as(
        'adj_letters',
      ),
    })
    .from(billingAdjustments)
    .groupBy(billingAdjustments.campaignId)
    .as('billing_adj');
}

export async function loadCampaignsByDealer(): Promise<CampaignAggregateRow<number>[]> {
  const adj = billingPivotSubquery();
  const rows = await db
    .select({
      dealerId: campaigns.dealerId,
      dealerName: dealers.name,
      count: sql<number>`count(${campaigns.id})::int`,
      totalQty: sql<number>`coalesce(sum(coalesce(${adj.adjRecords}, ${campaigns.qtyRecords})), 0)::int`,
      totalSms: sql<number>`coalesce(sum(coalesce(${adj.adjSms}, ${campaigns.smsEmail})), 0)::int`,
      totalLetters: sql<number>`coalesce(sum(coalesce(${adj.adjLetters}, ${campaigns.letters})), 0)::int`,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .leftJoin(adj, eq(adj.campaignId, campaigns.id))
    .groupBy(campaigns.dealerId, dealers.name)
    .orderBy(dealers.name);

  return rows.map((r) => ({
    groupKey: r.dealerId,
    groupLabel: r.dealerName,
    count: Number(r.count),
    totalQty: Number(r.totalQty),
    totalSms: Number(r.totalSms),
    totalLetters: Number(r.totalLetters),
  }));
}

export async function loadCampaignsByCoach(): Promise<CampaignAggregateRow<number | null>[]> {
  const adj = billingPivotSubquery();
  const rows = await db
    .select({
      coachId: campaigns.coachId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      count: sql<number>`count(${campaigns.id})::int`,
      totalQty: sql<number>`coalesce(sum(coalesce(${adj.adjRecords}, ${campaigns.qtyRecords})), 0)::int`,
      totalSms: sql<number>`coalesce(sum(coalesce(${adj.adjSms}, ${campaigns.smsEmail})), 0)::int`,
      totalLetters: sql<number>`coalesce(sum(coalesce(${adj.adjLetters}, ${campaigns.letters})), 0)::int`,
    })
    .from(campaigns)
    .leftJoin(contacts, eq(contacts.id, campaigns.coachId))
    .leftJoin(adj, eq(adj.campaignId, campaigns.id))
    .groupBy(campaigns.coachId, contacts.firstName, contacts.lastName)
    .orderBy(contacts.firstName, contacts.lastName);

  return rows.map((r) => ({
    groupKey: r.coachId,
    groupLabel:
      r.firstName || r.lastName
        ? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim()
        : 'Unassigned',
    count: Number(r.count),
    totalQty: Number(r.totalQty),
    totalSms: Number(r.totalSms),
    totalLetters: Number(r.totalLetters),
  }));
}

export async function loadCampaignsByMonth(): Promise<CampaignAggregateRow<string>[]> {
  // Group key is `YYYY-MM` derived from start_date — matches the legacy
  // summary's "by month" tab, which bucketed events by their start month.
  // A campaign that crosses a month boundary shows up under its start month
  // only; that's the legacy semantics and the simplest mental model.
  const monthKey = sql<string>`to_char(${campaigns.startDate}, 'YYYY-MM')`;
  const adj = billingPivotSubquery();
  const rows = await db
    .select({
      monthKey,
      count: sql<number>`count(${campaigns.id})::int`,
      totalQty: sql<number>`coalesce(sum(coalesce(${adj.adjRecords}, ${campaigns.qtyRecords})), 0)::int`,
      totalSms: sql<number>`coalesce(sum(coalesce(${adj.adjSms}, ${campaigns.smsEmail})), 0)::int`,
      totalLetters: sql<number>`coalesce(sum(coalesce(${adj.adjLetters}, ${campaigns.letters})), 0)::int`,
    })
    .from(campaigns)
    .leftJoin(adj, eq(adj.campaignId, campaigns.id))
    .groupBy(monthKey)
    .orderBy(monthKey);

  return rows.map((r) => ({
    groupKey: r.monthKey,
    groupLabel: formatYearMonth(r.monthKey),
    count: Number(r.count),
    totalQty: Number(r.totalQty),
    totalSms: Number(r.totalSms),
    totalLetters: Number(r.totalLetters),
  }));
}

/** All persisted billing adjustments, grouped by campaign id. Small table
 *  (one row per adjusted field per campaign); a single scan + in-TS group is
 *  simpler than a per-campaign join here. */
export async function loadBillingOverridesByCampaign(): Promise<
  Map<number, CampaignBillingOverrides>
> {
  const rows = await db
    .select({
      campaignId: billingAdjustments.campaignId,
      field: billingAdjustments.field,
      value: billingAdjustments.value,
    })
    .from(billingAdjustments);
  const byCampaign = new Map<number, CampaignBillingOverrides>();
  for (const r of rows) {
    const overrides = byCampaign.get(r.campaignId) ?? {};
    overrides[r.field as BillingField] = r.value;
    byCampaign.set(r.campaignId, overrides);
  }
  return byCampaign;
}

// Full Production Report tab is the `/production` flat list plus the billing
// overlay (0059). The original campaign columns stay on each row; `billing`
// carries the admin's per-field overrides so the report can render effective
// values while keeping the original recoverable.
export async function loadFullProductionReport(): Promise<FullReportCampaign[]> {
  const [list, overridesByCampaign] = await Promise.all([
    loadCampaigns(),
    loadBillingOverridesByCampaign(),
  ]);
  return list.map((c) => ({ ...c, billing: overridesByCampaign.get(c.id) ?? {} }));
}

export async function loadAvailabilityBlocks(
  rangeStart: string,
  rangeEnd: string
): Promise<AvailabilityBlock[]> {
  const rows = await db
    .select({
      id: availabilityBlocks.id,
      startDate: availabilityBlocks.startDate,
      endDate: availabilityBlocks.endDate,
      kind: availabilityBlocks.kind,
      coachId: availabilityBlocks.coachId,
      reason: availabilityBlocks.reason,
    })
    .from(availabilityBlocks)
    .where(
      and(
        isNull(availabilityBlocks.archivedAt),
        or(
          and(
            gte(availabilityBlocks.startDate, rangeStart),
            lte(availabilityBlocks.startDate, rangeEnd)
          ),
          and(
            gte(availabilityBlocks.endDate, rangeStart),
            lte(availabilityBlocks.endDate, rangeEnd)
          ),
          and(
            lte(availabilityBlocks.startDate, rangeStart),
            gte(availabilityBlocks.endDate, rangeEnd)
          )
        )
      )
    );
  return rows;
}
