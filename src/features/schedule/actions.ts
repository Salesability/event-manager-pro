'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contactIdentifiers, contacts, dealerContacts, dealers } from '@/lib/db/schema';
import { getUser } from '@/lib/supabase/session';

type ActionResult = { ok: true } | { error: string };

const generatePublicId = () => randomBytes(9).toString('base64url');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function parseId(formData: FormData, name = 'id'): number | null {
  const raw = formData.get(name);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validateContactInputs(input: {
  contactFirst: string;
  contactLast: string;
  contactEmail: string;
  contactPhone: string;
}): string | null {
  const hasAnyContactField =
    input.contactFirst || input.contactLast || input.contactEmail || input.contactPhone;
  if (hasAnyContactField) {
    if (!input.contactFirst || !input.contactLast) {
      return 'Contact first and last name are both required when adding a contact.';
    }
  }
  if (input.contactEmail && !EMAIL_RE.test(input.contactEmail)) {
    return 'Contact email looks invalid.';
  }
  return null;
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

    if (contactEmail) {
      await tx.insert(contactIdentifiers).values({
        contactId: contactRow.id,
        kind: 'email',
        value: contactEmail,
        isPrimary: true,
        source: 'admin',
        createdById: userId,
        updatedById: userId,
      });
    }
    if (contactPhone) {
      await tx.insert(contactIdentifiers).values({
        contactId: contactRow.id,
        kind: 'phone',
        value: contactPhone,
        isPrimary: true,
        source: 'admin',
        createdById: userId,
        updatedById: userId,
      });
    }
  });

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

  await db.transaction(async (tx) => {
    await tx
      .update(dealers)
      .set({ name, address: address || null, updatedById: userId })
      .where(eq(dealers.id, id));

    const hasContactInputs = contactFirst || contactLast || contactEmail || contactPhone;
    if (!hasContactInputs) return;

    const [link] = await tx
      .select({ id: dealerContacts.id, contactId: dealerContacts.contactId })
      .from(dealerContacts)
      .where(
        and(
          eq(dealerContacts.dealerId, id),
          eq(dealerContacts.role, 'staff'),
          isNull(dealerContacts.archivedAt)
        )
      )
      .limit(1);

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

  revalidatePath('/lists');
  revalidatePath('/production');
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
