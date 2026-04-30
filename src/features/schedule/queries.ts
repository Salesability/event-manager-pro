import 'server-only';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  availabilityBlocks,
  campaigns,
  campaignStyles,
  contactIdentifiers,
  contacts,
  dealerContacts,
  dealers,
  salesLeadSources,
  teamMemberRoles,
} from '@/lib/db/schema';

export type Dealer = {
  id: number;
  publicId: string;
  name: string;
  address: string | null;
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
      contactId: link?.contactId ?? null,
      contactFirstName: link?.firstName ?? null,
      contactLastName: link?.lastName ?? null,
      primaryEmail: ident?.email ?? null,
      primaryPhone: ident?.phone ?? null,
    };
  });
}

export async function loadDealer(id: number): Promise<Dealer | null> {
  const [row] = await db
    .select({
      id: dealers.id,
      publicId: dealers.publicId,
      name: dealers.name,
      address: dealers.address,
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
