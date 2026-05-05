'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
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
import { requireAdmin } from '@/lib/auth/require-admin';
import { getUser } from '@/lib/supabase/session';
import {
  EMAIL_RE,
  field,
  parseCampaignInput,
  parseDate,
  parseId,
  parseOptionalId,
  validateContactInputs,
} from './validators';

type ActionResult = { ok: true } | { error: string };
type ActionError = { error: string };
type AvailabilityKind = 'statutory_holiday' | 'company_closure' | 'coach_unavailable';

const generatePublicId = () => randomBytes(9).toString('base64url');

class IdentifierConflictError extends Error {
  constructor(
    readonly kind: 'email' | 'phone',
    readonly value: string,
  ) {
    super(`${kind} ${value} already in use`);
    this.name = 'IdentifierConflictError';
  }
}

function toActionResult(err: unknown): ActionResult {
  if (err instanceof IdentifierConflictError) {
    const noun = err.kind === 'email' ? 'email address' : 'phone number';
    return { error: `That ${noun} is already linked to another contact.` };
  }
  throw err;
}

async function requireUserId(): Promise<string> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user.id;
}

export async function createDealer(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const name = field(formData, 'name');
  const address = field(formData, 'address');
  const contactFirst = field(formData, 'contactFirst');
  const contactLast = field(formData, 'contactLast');
  const contactEmail = field(formData, 'contactEmail').toLowerCase();
  const contactPhone = field(formData, 'contactPhone');

  if (!name) return { error: 'Dealership name is required.' };
  const contactErr = validateContactInputs({
    contactFirst,
    contactLast,
    contactEmail,
    contactPhone,
  });
  if (contactErr) return { error: contactErr };

  try {
    await db.transaction(async (tx) => {
      const [dealerRow] = await tx
        .insert(dealers)
        .values({
          publicId: generatePublicId(),
          name,
          address: address || null,
          createdById: userId,
          updatedById: userId,
        })
        .returning({ id: dealers.id });

      const hasContact = contactFirst || contactLast;
      if (!hasContact) return;

      const [contactRow] = await tx
        .insert(contacts)
        .values({
          firstName: contactFirst,
          lastName: contactLast,
          createdById: userId,
          updatedById: userId,
        })
        .returning({ id: contacts.id });

      await tx.insert(dealerContacts).values({
        dealerId: dealerRow.id,
        contactId: contactRow.id,
        role: 'staff',
        source: 'admin',
        createdById: userId,
        updatedById: userId,
      });

      await swapPrimaryIdentifier(tx, contactRow.id, 'email', contactEmail, userId);
      await swapPrimaryIdentifier(tx, contactRow.id, 'phone', contactPhone, userId);
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath('/lists');
  revalidatePath('/production');
  return { ok: true };
}

export async function updateDealer(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid dealer id.' };

  const name = field(formData, 'name');
  const address = field(formData, 'address');
  const contactFirst = field(formData, 'contactFirst');
  const contactLast = field(formData, 'contactLast');
  const contactEmail = field(formData, 'contactEmail').toLowerCase();
  const contactPhone = field(formData, 'contactPhone');

  if (!name) return { error: 'Dealership name is required.' };
  const contactErr = validateContactInputs({
    contactFirst,
    contactLast,
    contactEmail,
    contactPhone,
  });
  if (contactErr) return { error: contactErr };

  const dealerExists = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)))
    .limit(1);
  if (!dealerExists.length) return { error: 'Dealer not found.' };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(dealers)
        .set({ name, address: address || null, updatedById: userId })
        .where(eq(dealers.id, id));

      const hasContactInputs = contactFirst || contactLast || contactEmail || contactPhone;
      if (!hasContactInputs) return;

      // Mirror loadDealers' priority (staff > customer > prospect): edit the
      // existing primary link in place rather than creating a duplicate when
      // the imported link is role='customer'.
      const links = await tx
        .select({ id: dealerContacts.id, contactId: dealerContacts.contactId, role: dealerContacts.role })
        .from(dealerContacts)
        .where(and(eq(dealerContacts.dealerId, id), isNull(dealerContacts.archivedAt)));
      const rolePriority = { staff: 0, customer: 1, prospect: 2 } as const;
      const link = links.length
        ? links.reduce((best, cur) => (rolePriority[cur.role] < rolePriority[best.role] ? cur : best))
        : null;

      let contactId: number;
      if (link) {
        contactId = link.contactId;
        if (contactFirst && contactLast) {
          await tx
            .update(contacts)
            .set({ firstName: contactFirst, lastName: contactLast, updatedById: userId })
            .where(eq(contacts.id, contactId));
        }
      } else {
        if (!contactFirst || !contactLast) {
          // No staff link yet, but we don't have enough name input to create one.
          // Email/phone alone aren't sufficient for a contacts row (NOT NULL names).
          return;
        }
        const [contactRow] = await tx
          .insert(contacts)
          .values({
            firstName: contactFirst,
            lastName: contactLast,
            createdById: userId,
            updatedById: userId,
          })
          .returning({ id: contacts.id });
        contactId = contactRow.id;

        await tx.insert(dealerContacts).values({
          dealerId: id,
          contactId,
          role: 'staff',
          source: 'admin',
          createdById: userId,
          updatedById: userId,
        });
      }

      await swapPrimaryIdentifier(tx, contactId, 'email', contactEmail, userId);
      await swapPrimaryIdentifier(tx, contactId, 'phone', contactPhone, userId);
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath('/lists');
  revalidatePath('/production');
  return { ok: true };
}

function revalidateCoachViews() {
  revalidatePath('/lists');
  revalidatePath('/calendar');
  revalidatePath('/production');
}

export async function createCoach(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const firstName = field(formData, 'firstName');
  const lastName = field(formData, 'lastName');
  const specialty = field(formData, 'specialty');
  const email = field(formData, 'email').toLowerCase();
  const phone = field(formData, 'phone');

  if (!firstName || !lastName) return { error: 'First and last name are required.' };
  if (email && !EMAIL_RE.test(email)) return { error: 'Email looks invalid.' };

  try {
    await db.transaction(async (tx) => {
      const [contactRow] = await tx
        .insert(contacts)
        .values({
          firstName,
          lastName,
          createdById: userId,
          updatedById: userId,
        })
        .returning({ id: contacts.id });

      await tx.insert(teamMemberRoles).values({
        contactId: contactRow.id,
        role: 'coach',
        specialty: specialty || null,
        createdById: userId,
        updatedById: userId,
      });

      await swapPrimaryIdentifier(tx, contactRow.id, 'email', email, userId);
      await swapPrimaryIdentifier(tx, contactRow.id, 'phone', phone, userId);
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidateCoachViews();
  return { ok: true };
}

export async function updateCoach(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid coach id.' };

  const firstName = field(formData, 'firstName');
  const lastName = field(formData, 'lastName');
  const specialty = field(formData, 'specialty');
  const email = field(formData, 'email').toLowerCase();
  const phone = field(formData, 'phone');

  if (!firstName || !lastName) return { error: 'First and last name are required.' };
  if (email && !EMAIL_RE.test(email)) return { error: 'Email looks invalid.' };

  const [coach] = await db
    .select({ id: contacts.id })
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
  if (!coach) return { error: 'Coach not found.' };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({ firstName, lastName, updatedById: userId })
        .where(eq(contacts.id, id));

      await tx
        .update(teamMemberRoles)
        .set({ specialty: specialty || null, updatedById: userId })
        .where(
          and(
            eq(teamMemberRoles.contactId, id),
            eq(teamMemberRoles.role, 'coach'),
            isNull(teamMemberRoles.archivedAt)
          )
        );

      await swapPrimaryIdentifier(tx, id, 'email', email, userId);
      await swapPrimaryIdentifier(tx, id, 'phone', phone, userId);
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidateCoachViews();
  return { ok: true };
}

export async function archiveCoach(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid coach id.' };

  await db
    .update(teamMemberRoles)
    .set({ archivedAt: new Date(), updatedById: userId })
    .where(
      and(
        eq(teamMemberRoles.contactId, id),
        eq(teamMemberRoles.role, 'coach'),
        isNull(teamMemberRoles.archivedAt)
      )
    );

  revalidateCoachViews();
  return { ok: true };
}

export async function archiveDealer(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid dealer id.' };

  await db
    .update(dealers)
    .set({ archivedAt: new Date(), updatedById: userId })
    .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)));

  revalidatePath('/lists');
  revalidatePath('/production');
  return { ok: true };
}

// ---------- Campaigns (5.2) ----------

function revalidateCampaignViews() {
  revalidatePath('/calendar');
  revalidatePath('/production');
  revalidatePath('/admin/lookups');
  // [id] placeholder revalidates every coach-share page variant.
  revalidatePath('/share/coach/[id]', 'page');
}

function revalidateAvailabilityViews() {
  revalidatePath('/calendar');
  revalidatePath('/share/coach/[id]', 'page');
}

function revalidateLookupViews() {
  revalidateCampaignViews();
}

export async function createCampaign(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const input = parseCampaignInput(formData);
  if ('error' in input) return input;

  const dealerExists = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(and(eq(dealers.id, input.dealerId), isNull(dealers.archivedAt)))
    .limit(1);
  if (!dealerExists.length) return { error: 'Dealer not found.' };

  await db.insert(campaigns).values({
    publicId: generatePublicId(),
    status: 'booked',
    createdById: userId,
    updatedById: userId,
    ...input,
  });

  revalidateCampaignViews();
  return { ok: true };
}

export async function updateCampaign(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid campaign id.' };

  const input = parseCampaignInput(formData);
  if ('error' in input) return input;

  const dealerExists = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(and(eq(dealers.id, input.dealerId), isNull(dealers.archivedAt)))
    .limit(1);
  if (!dealerExists.length) return { error: 'Dealer not found.' };

  const result = await db
    .update(campaigns)
    .set({ ...input, updatedById: userId })
    .where(eq(campaigns.id, id))
    .returning({ id: campaigns.id });
  if (!result.length) return { error: 'Campaign not found.' };

  revalidateCampaignViews();
  return { ok: true };
}

export async function cancelCampaign(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid campaign id.' };

  const result = await db
    .update(campaigns)
    .set({ status: 'cancelled', updatedById: userId })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, ['draft', 'booked'])))
    .returning({ id: campaigns.id });
  if (!result.length) {
    // Either the row doesn't exist, or it's already cancelled / completed.
    return { error: 'Campaign cannot be cancelled in its current state.' };
  }

  revalidateCampaignViews();
  return { ok: true };
}

// ---------- Lookups (5.3) ----------

function parseLookupLabel(formData: FormData): string | ActionResult {
  const label = field(formData, 'label');
  if (!label) return { error: 'Label is required.' };
  if (label.length > 120) return { error: 'Label must be 120 characters or fewer.' };
  return label;
}

function lookupActionResult(err: unknown): ActionResult {
  if (err instanceof Error && err.message.includes('duplicate key')) {
    return { error: 'That label already exists.' };
  }
  throw err;
}

export async function createCampaignStyle(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const label = parseLookupLabel(formData);
  if (typeof label !== 'string') return label;

  try {
    const restored = await db
      .update(campaignStyles)
      .set({ archivedAt: null })
      .where(and(eq(campaignStyles.label, label), isNotNull(campaignStyles.archivedAt)))
      .returning({ id: campaignStyles.id });
    if (!restored.length) {
      await db.insert(campaignStyles).values({ label });
    }
  } catch (err) {
    return lookupActionResult(err);
  }

  revalidateLookupViews();
  return { ok: true };
}

export async function updateCampaignStyle(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid style id.' };
  const label = parseLookupLabel(formData);
  if (typeof label !== 'string') return label;

  try {
    const result = await db
      .update(campaignStyles)
      .set({ label })
      .where(and(eq(campaignStyles.id, id), isNull(campaignStyles.archivedAt)))
      .returning({ id: campaignStyles.id });
    if (!result.length) return { error: 'Style not found.' };
  } catch (err) {
    return lookupActionResult(err);
  }

  revalidateLookupViews();
  return { ok: true };
}

export async function archiveCampaignStyle(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid style id.' };

  await db
    .update(campaignStyles)
    .set({ archivedAt: new Date() })
    .where(and(eq(campaignStyles.id, id), isNull(campaignStyles.archivedAt)));

  revalidateLookupViews();
  return { ok: true };
}

export async function createSalesLeadSource(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const label = parseLookupLabel(formData);
  if (typeof label !== 'string') return label;

  try {
    const restored = await db
      .update(salesLeadSources)
      .set({ archivedAt: null })
      .where(and(eq(salesLeadSources.label, label), isNotNull(salesLeadSources.archivedAt)))
      .returning({ id: salesLeadSources.id });
    if (!restored.length) {
      await db.insert(salesLeadSources).values({ label });
    }
  } catch (err) {
    return lookupActionResult(err);
  }

  revalidateLookupViews();
  return { ok: true };
}

export async function updateSalesLeadSource(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid data source id.' };
  const label = parseLookupLabel(formData);
  if (typeof label !== 'string') return label;

  try {
    const result = await db
      .update(salesLeadSources)
      .set({ label })
      .where(and(eq(salesLeadSources.id, id), isNull(salesLeadSources.archivedAt)))
      .returning({ id: salesLeadSources.id });
    if (!result.length) return { error: 'Data source not found.' };
  } catch (err) {
    return lookupActionResult(err);
  }

  revalidateLookupViews();
  return { ok: true };
}

export async function archiveSalesLeadSource(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid data source id.' };

  await db
    .update(salesLeadSources)
    .set({ archivedAt: new Date() })
    .where(and(eq(salesLeadSources.id, id), isNull(salesLeadSources.archivedAt)));

  revalidateLookupViews();
  return { ok: true };
}

// ---------- Availability blocks (5.4) ----------

const AVAILABILITY_KINDS: AvailabilityKind[] = [
  'statutory_holiday',
  'company_closure',
  'coach_unavailable',
];

type AvailabilityInput = {
  startDate: string;
  endDate: string;
  kind: AvailabilityKind;
  coachId: number | null;
  reason: string | null;
};

function parseAvailabilityInput(formData: FormData): AvailabilityInput | ActionError {
  const startDate = parseDate(formData, 'startDate');
  const endDate = parseDate(formData, 'endDate') ?? startDate;
  if (!startDate || !endDate) return { error: 'Start date is required.' };
  if (endDate < startDate) return { error: 'End date must be on or after start date.' };

  const kind = field(formData, 'kind') as AvailabilityKind;
  if (!AVAILABILITY_KINDS.includes(kind)) return { error: 'Invalid block type.' };

  const coachId = parseOptionalId(formData, 'coachId');
  if (kind === 'coach_unavailable' && coachId == null) {
    return { error: 'Coach is required for coach unavailability.' };
  }
  if (kind !== 'coach_unavailable' && coachId != null) {
    return { error: 'Coach can only be set for coach unavailability.' };
  }

  const reason = field(formData, 'reason');
  if (reason.length > 200) return { error: 'Reason must be 200 characters or fewer.' };

  return {
    startDate,
    endDate,
    kind,
    coachId,
    reason: reason || null,
  };
}

async function validateAvailabilityCoach(input: AvailabilityInput): Promise<ActionResult | null> {
  if (input.coachId == null) return null;
  const [coach] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .innerJoin(
      teamMemberRoles,
      and(
        eq(teamMemberRoles.contactId, contacts.id),
        eq(teamMemberRoles.role, 'coach'),
        isNull(teamMemberRoles.archivedAt)
      )
    )
    .where(and(eq(contacts.id, input.coachId), isNull(contacts.archivedAt)))
    .limit(1);
  return coach ? null : { error: 'Coach not found.' };
}

export async function createAvailabilityBlock(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const input = parseAvailabilityInput(formData);
  if ('error' in input) return input;
  const coachError = await validateAvailabilityCoach(input);
  if (coachError) return coachError;

  await db.insert(availabilityBlocks).values({
    ...input,
    source: 'admin',
    createdById: userId,
    updatedById: userId,
  });

  revalidateAvailabilityViews();
  return { ok: true };
}

export async function updateAvailabilityBlock(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid availability block id.' };
  const input = parseAvailabilityInput(formData);
  if ('error' in input) return input;
  const coachError = await validateAvailabilityCoach(input);
  if (coachError) return coachError;

  const result = await db
    .update(availabilityBlocks)
    .set({ ...input, updatedById: userId })
    .where(and(eq(availabilityBlocks.id, id), isNull(availabilityBlocks.archivedAt)))
    .returning({ id: availabilityBlocks.id });
  if (!result.length) return { error: 'Availability block not found.' };

  revalidateAvailabilityViews();
  return { ok: true };
}

export async function archiveAvailabilityBlock(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  const id = parseId(formData);
  if (id == null) return { error: 'Invalid availability block id.' };

  await db
    .update(availabilityBlocks)
    .set({ archivedAt: new Date(), updatedById: userId })
    .where(and(eq(availabilityBlocks.id, id), isNull(availabilityBlocks.archivedAt)));

  revalidateAvailabilityViews();
  return { ok: true };
}

async function swapPrimaryIdentifier(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  contactId: number,
  kind: 'email' | 'phone',
  newValue: string,
  userId: string
) {
  const [existing] = await tx
    .select({ id: contactIdentifiers.id, value: contactIdentifiers.value })
    .from(contactIdentifiers)
    .where(
      and(
        eq(contactIdentifiers.contactId, contactId),
        eq(contactIdentifiers.kind, kind),
        eq(contactIdentifiers.isPrimary, true),
        isNull(contactIdentifiers.archivedAt)
      )
    )
    .limit(1);

  if (!newValue) {
    if (existing) {
      await tx
        .update(contactIdentifiers)
        .set({ archivedAt: new Date(), isPrimary: false, updatedById: userId })
        .where(eq(contactIdentifiers.id, existing.id));
    }
    return;
  }

  if (existing && existing.value === newValue) return;

  // Pre-check the global active-uniqueness index
  // (contact_identifiers_kind_value_active_unique) before mutating, so a
  // conflict surfaces as a clean toast rather than a 500 from the constraint.
  const conflict = await tx
    .select({ contactId: contactIdentifiers.contactId })
    .from(contactIdentifiers)
    .where(
      and(
        eq(contactIdentifiers.kind, kind),
        eq(contactIdentifiers.value, newValue),
        ne(contactIdentifiers.contactId, contactId),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .limit(1);
  if (conflict.length > 0) {
    throw new IdentifierConflictError(kind, newValue);
  }

  if (existing) {
    // Demote the old primary first to free up the
    // contact_identifiers_contact_kind_primary_unique partial index.
    await tx
      .update(contactIdentifiers)
      .set({ archivedAt: new Date(), isPrimary: false, updatedById: userId })
      .where(eq(contactIdentifiers.id, existing.id));
  }

  await tx.insert(contactIdentifiers).values({
    contactId,
    kind,
    value: newValue,
    isPrimary: true,
    source: 'admin',
    createdById: userId,
    updatedById: userId,
  });
}
