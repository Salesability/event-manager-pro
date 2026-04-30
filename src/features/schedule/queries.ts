import 'server-only';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  availabilityBlocks,
  campaigns,
  campaignStyles,
  contactIdentifiers,
  contacts,
  dealers,
  salesLeadSources,
  teamMemberRoles,
} from '@/lib/db/schema';

export type Dealer = {
  id: number;
  publicId: string;
  name: string;
  address: string | null;
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
  styleLabel: string | null;
  salesLeadSourceLabel: string | null;
  qtyRecords: number | null;
  smsEmail: number | null;
  letters: number | null;
  bdc: number | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

export type AvailabilityBlock = {
  id: number;
  startDate: string;
  endDate: string;
  kind: 'statutory_holiday' | 'company_closure' | 'coach_unavailable';
  coachId: number | null;
  reason: string | null;
};

export async function loadDealers(): Promise<Dealer[]> {
  const rows = await db
    .select({
      id: dealers.id,
      publicId: dealers.publicId,
      name: dealers.name,
      address: dealers.address,
    })
    .from(dealers)
    .where(isNull(dealers.archivedAt))
    .orderBy(dealers.name);
  return rows;
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
      styleLabel: campaignStyles.label,
      salesLeadSourceLabel: salesLeadSources.label,
      qtyRecords: campaigns.qtyRecords,
      smsEmail: campaigns.smsEmail,
      letters: campaigns.letters,
      bdc: campaigns.bdc,
      contact: campaigns.contact,
      phone: campaigns.phone,
      email: campaigns.email,
      notes: campaigns.notes,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .leftJoin(contacts, eq(contacts.id, campaigns.coachId))
    .leftJoin(campaignStyles, eq(campaignStyles.id, campaigns.styleId))
    .leftJoin(salesLeadSources, eq(salesLeadSources.id, campaigns.salesLeadSourceId))
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
    styleLabel: r.styleLabel,
    salesLeadSourceLabel: r.salesLeadSourceLabel,
    qtyRecords: r.qtyRecords,
    smsEmail: r.smsEmail,
    letters: r.letters,
    bdc: r.bdc,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
  }));
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
