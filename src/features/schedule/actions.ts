'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
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
  audienceSources,
  teamMemberRoles,
} from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { recordAudit } from '@/features/audit/actions';
import { ensureAvailabilityOwnership } from './availability-authz';
import { dealerFormSchema } from '@/features/dealers/dealer-schema';
import { availabilityFormSchema } from './availability-schema';
import {
  field,
  parseCampaignInput,
  parseId,
} from './validators';

type FieldErrors = Record<string, string[] | undefined>;
function firstFieldError(fieldErrors: FieldErrors): string | undefined {
  for (const list of Object.values(fieldErrors)) {
    if (list && list.length) return list[0];
  }
  return undefined;
}

type ActionResult =
  | { ok: true }
  | { error: string; fieldErrors?: Record<string, string[] | undefined> };
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

type DealerStatus = 'prospect' | 'active';

/** Cross-field "if any contact field is filled, first+last must both be filled".
 *  Lives in the action (not the schema) because zod's per-field validation
 *  can't model the "all-or-nothing contact block" rule cleanly. */
function validateContactCross(input: {
  contactFirst: string;
  contactLast: string;
  contactEmail: string;
  contactPhone: string;
}): string | null {
  const hasAny =
    input.contactFirst || input.contactLast || input.contactEmail || input.contactPhone;
  if (hasAny && (!input.contactFirst || !input.contactLast)) {
    return 'Contact first and last name are both required when adding a contact.';
  }
  return null;
}

export const createDealer = capabilityClient('dealer:create')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const parsed = dealerFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return { error: firstFieldError(fieldErrors) ?? 'Invalid dealer input.', fieldErrors };
    }
    const v = parsed.data;
    const name = v.name;
    const address = v.address ?? '';
    const contactFirst = v.contactFirst ?? '';
    const contactLast = v.contactLast ?? '';
    const contactEmail = (v.contactEmail ?? '').toLowerCase();
    const contactPhone = v.contactPhone ?? '';

    const contactErr = validateContactCross({
      contactFirst,
      contactLast,
      contactEmail,
      contactPhone,
    });
    if (contactErr) return { error: contactErr };

    // Default for first-class /dealerships entry: 'active' (back-office adds a
    // dealer who's already a customer). The composer's inline-create flow
    // submits an explicit `status=prospect` so a quote-driven add lands as a
    // prospect — see 0035 Phase 2/3.
    const status: DealerStatus = v.status ?? 'active';
    const acquiredVia: string | null = v.acquiredVia ? v.acquiredVia : null;

    try {
      await db.transaction(async (tx) => {
        const [dealerRow] = await tx
          .insert(dealers)
          .values({
            publicId: generatePublicId(),
            name,
            address: address || null,
            status,
            acquiredVia: acquiredVia as string | null,
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

        // 0023 Phase 4: every dealer-side contact gets a `dealer` team-member
        // role too, so the People-admin filter / People dialog can surface
        // them and Phase 5's "every contact has a role" invariant holds.
        await tx.insert(teamMemberRoles).values({
          contactId: contactRow.id,
          role: 'dealer',
          createdById: userId,
          updatedById: userId,
        });

        await swapPrimaryIdentifier(tx, contactRow.id, 'email', contactEmail, userId);
        await swapPrimaryIdentifier(tx, contactRow.id, 'phone', contactPhone, userId);
      });
    } catch (err) {
      return toActionResult(err);
    }

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true };
  });

export const updateDealer = capabilityClient('dealer:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid dealer id.' };

    const parsed = dealerFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return { error: firstFieldError(fieldErrors) ?? 'Invalid dealer input.', fieldErrors };
    }
    const v = parsed.data;
    const name = v.name;
    const address = v.address ?? '';
    const contactFirst = v.contactFirst ?? '';
    const contactLast = v.contactLast ?? '';
    const contactEmail = (v.contactEmail ?? '').toLowerCase();
    const contactPhone = v.contactPhone ?? '';

    const contactErr = validateContactCross({
      contactFirst,
      contactLast,
      contactEmail,
      contactPhone,
    });
    if (contactErr) return { error: contactErr };

    // status / acquiredVia are "patches" — omit-when-absent so a caller that
    // doesn't submit the field can't clobber a concurrent flip (e.g.
    // `convertProspectToActive` racing with the form-save). The schema's
    // `status` preprocesses `'' → undefined`, so an empty status string also
    // counts as absent. `acquiredVia` is *not* preprocessed — `''` survives
    // as "clear to null", absent stays undefined as "preserve".
    const statusPatch: DealerStatus | undefined = v.status;
    const acquiredViaPatch: string | null | undefined = formData.has('acquiredVia')
      ? (v.acquiredVia ?? '') || null
      : undefined;

    const dealerPatch: Record<string, unknown> = {
      name,
      address: address || null,
      updatedById: userId,
    };
    if (statusPatch !== undefined) dealerPatch.status = statusPatch;
    if (acquiredViaPatch !== undefined) dealerPatch.acquiredVia = acquiredViaPatch;

  let notFound = false;
  try {
    await db.transaction(async (tx) => {
      // Guarded UPDATE — `archivedAt IS NULL` in the WHERE closes the TOCTOU
      // window where a concurrent `archiveDealer` could land between a
      // SELECT-existence check and the UPDATE-by-id.
      const updated = await tx
        .update(dealers)
        .set(dealerPatch)
        .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)))
        .returning({ id: dealers.id });
      if (!updated.length) {
        notFound = true;
        return;
      }

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

      // 0023 Phase 4: ensure the contact has an ACTIVE `dealer` team-member
      // role. For the new-contact branch, this is the first row. For the
      // existing-link branch, Phase 2's backfill already inserted it for
      // every existing dealer-side contact — but the upsert defensively
      // handles two failure modes:
      //   - a legacy contact that pre-dated Phase 2's backfill (none on
      //     dev; could exist on prod); insert wins.
      //   - a contact whose `dealer` row was previously ARCHIVED (e.g.
      //     `archivePerson` ran on them); the upsert un-archives it,
      //     because `onConflictDoNothing` would have left them without an
      //     active dealer role despite being an active dealer-side contact.
      // The conflict target is the unconditional `(contact_id, role)`
      // unique index in `src/lib/db/schema/team-member-roles.ts`.
      await tx
        .insert(teamMemberRoles)
        .values({
          contactId,
          role: 'dealer',
          createdById: userId,
          updatedById: userId,
        })
        .onConflictDoUpdate({
          target: [teamMemberRoles.contactId, teamMemberRoles.role],
          set: { archivedAt: null, updatedById: userId },
        });

        await swapPrimaryIdentifier(tx, contactId, 'email', contactEmail, userId);
        await swapPrimaryIdentifier(tx, contactId, 'phone', contactPhone, userId);
      });
    } catch (err) {
      return toActionResult(err);
    }
    if (notFound) return { error: 'Dealer not found.' };

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true };
  });

// `createCoach` / `updateCoach` / `archiveCoach` retired in 0020 Phase 4 —
// the People page (`/admin/people`) handles all three via `createPerson` /
// `updatePerson` / `archivePerson` in `src/features/people/actions.ts`. The
// read path (`loadCoaches` in `queries.ts`) stays — it's used by `/calendar`,
// `/production`, `/share/coach/[id]`, and the booking-form coach picker.

export const archiveDealer = capabilityClient('dealer:archive')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid dealer id.' };

    const result = await db
      .update(dealers)
      .set({ archivedAt: new Date(), updatedById: userId })
      .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)))
      .returning({ id: dealers.id });

    if (result.length) {
      await recordAudit({
        action: 'dealer.archived',
        targetTable: 'dealers',
        targetId: id,
        payload: null,
      });
    }

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true };
  });

// Flip a prospect dealer to `active`. Called manually from the dealer detail
// in v1 and automatically by 0026's `acceptQuote` when an accepted quote ties
// to a prospect dealer (the implicit "first signed deal" promotion). Idempotent
// — re-running on an already-active or archived row is a no-op that emits no
// audit row, matching the cancelCampaign atomic-transition pattern.
export const convertProspectToActive = capabilityClient('dealer:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid dealer id.' };

    const result = await db
      .update(dealers)
      .set({ status: 'active', updatedById: userId })
      .where(
        and(
          eq(dealers.id, id),
          eq(dealers.status, 'prospect'),
          isNull(dealers.archivedAt),
        ),
      )
      .returning({ id: dealers.id });

    if (result.length) {
      await recordAudit({
        action: 'dealer.activated',
        targetTable: 'dealers',
        targetId: id,
        payload: { from: 'prospect' },
      });
    }

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true };
  });

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

export const createCampaign = capabilityClient('campaign:create')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

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
  });

export const updateCampaign = capabilityClient('campaign:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

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
  });

export const cancelCampaign = capabilityClient('campaign:cancel')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

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

    await recordAudit({
      action: 'campaign.cancelled',
      targetTable: 'campaigns',
      targetId: id,
      payload: null,
    });

    revalidateCampaignViews();
    return { ok: true };
  });

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

export const createCampaignStyle = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
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
  });

export const updateCampaignStyle = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
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
  });

export const archiveCampaignStyle = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const id = parseId(formData);
    if (id == null) return { error: 'Invalid style id.' };

    await db
      .update(campaignStyles)
      .set({ archivedAt: new Date() })
      .where(and(eq(campaignStyles.id, id), isNull(campaignStyles.archivedAt)));

    revalidateLookupViews();
    return { ok: true };
  });

export const createAudienceSource = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const label = parseLookupLabel(formData);
    if (typeof label !== 'string') return label;

    try {
      const restored = await db
        .update(audienceSources)
        .set({ archivedAt: null })
        .where(and(eq(audienceSources.label, label), isNotNull(audienceSources.archivedAt)))
        .returning({ id: audienceSources.id });
      if (!restored.length) {
        await db.insert(audienceSources).values({ label });
      }
    } catch (err) {
      return lookupActionResult(err);
    }

    revalidateLookupViews();
    return { ok: true };
  });

export const updateAudienceSource = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const id = parseId(formData);
    if (id == null) return { error: 'Invalid data source id.' };
    const label = parseLookupLabel(formData);
    if (typeof label !== 'string') return label;

    try {
      const result = await db
        .update(audienceSources)
        .set({ label })
        .where(and(eq(audienceSources.id, id), isNull(audienceSources.archivedAt)))
        .returning({ id: audienceSources.id });
      if (!result.length) return { error: 'Data source not found.' };
    } catch (err) {
      return lookupActionResult(err);
    }

    revalidateLookupViews();
    return { ok: true };
  });

export const archiveAudienceSource = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const id = parseId(formData);
    if (id == null) return { error: 'Invalid data source id.' };

    await db
      .update(audienceSources)
      .set({ archivedAt: new Date() })
      .where(and(eq(audienceSources.id, id), isNull(audienceSources.archivedAt)));

    revalidateLookupViews();
    return { ok: true };
  });

// ---------- Availability blocks (5.4) ----------

type AvailabilityInput = {
  startDate: string;
  endDate: string;
  kind: AvailabilityKind;
  coachId: number | null;
  reason: string | null;
};

function parseAvailabilityInput(
  formData: FormData,
):
  | { ok: true; data: AvailabilityInput }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } {
  const parsed = availabilityFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const message =
      firstFieldError(fieldErrors) ?? 'Invalid availability-block input.';
    return { ok: false, error: message, fieldErrors };
  }
  const v = parsed.data;
  const startDate = v.startDate;
  const endDate = v.endDate && v.endDate.length > 0 ? v.endDate : startDate;
  if (endDate < startDate) {
    return { ok: false, error: 'End date must be on or after start date.' };
  }

  const kind = v.kind;
  const coachIdStr = v.coachId;
  const coachId = coachIdStr && coachIdStr.length > 0 ? Number(coachIdStr) : null;
  if (kind === 'coach_unavailable' && coachId == null) {
    return { ok: false, error: 'Coach is required for coach unavailability.' };
  }
  if (kind !== 'coach_unavailable' && coachId != null) {
    return {
      ok: false,
      error: 'Coach can only be set for coach unavailability.',
    };
  }

  const reason = v.reason ?? '';
  return {
    ok: true,
    data: { startDate, endDate, kind, coachId, reason: reason || null },
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

export const createAvailabilityBlock = capabilityClient('availability:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const user = ctx.user;
    const userId = user.id;

    const inputResult = parseAvailabilityInput(formData);
    if (!inputResult.ok) {
      return {
        error: inputResult.error,
        ...(inputResult.fieldErrors ? { fieldErrors: inputResult.fieldErrors } : {}),
      };
    }
    const input = inputResult.data;
    const coachError = await validateAvailabilityCoach(input);
    if (coachError) return coachError;

    const ownsErr = await ensureAvailabilityOwnership(user, input);
    if (ownsErr) return ownsErr;

    await db.insert(availabilityBlocks).values({
      ...input,
      source: 'admin',
      createdById: userId,
      updatedById: userId,
    });

    revalidateAvailabilityViews();
    return { ok: true };
  });

export const updateAvailabilityBlock = capabilityClient('availability:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const user = ctx.user;
    const userId = user.id;
    const userIsAdmin = isAdmin(user);

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid availability block id.' };
    const inputResult = parseAvailabilityInput(formData);
    if (!inputResult.ok) {
      return {
        error: inputResult.error,
        ...(inputResult.fieldErrors ? { fieldErrors: inputResult.fieldErrors } : {}),
      };
    }
    const input = inputResult.data;
    const coachError = await validateAvailabilityCoach(input);
    if (coachError) return coachError;

    let myCoachId: number | null = null;
    if (!userIsAdmin) {
      myCoachId = (await loadCurrentMembership())?.coachContactId ?? null;
      const [existing] = await db
        .select({ kind: availabilityBlocks.kind, coachId: availabilityBlocks.coachId })
        .from(availabilityBlocks)
        .where(and(eq(availabilityBlocks.id, id), isNull(availabilityBlocks.archivedAt)))
        .limit(1);
      if (!existing) return { error: 'Availability block not found.' };
      const ownsErr = await ensureAvailabilityOwnership(user, existing, input);
      if (ownsErr) return ownsErr;
    }

    // Non-admins also constrain the UPDATE's WHERE on kind + coach_id, so a
    // concurrent admin transfer of the block between the ownership check and
    // the write doesn't get clobbered. `myCoachId` is non-null on the non-admin
    // branch — `ensureAvailabilityOwnership` would have returned an error first.
    const where =
      userIsAdmin
        ? and(eq(availabilityBlocks.id, id), isNull(availabilityBlocks.archivedAt))
        : and(
            eq(availabilityBlocks.id, id),
            isNull(availabilityBlocks.archivedAt),
            eq(availabilityBlocks.kind, 'coach_unavailable'),
            eq(availabilityBlocks.coachId, myCoachId!),
          );

    const result = await db
      .update(availabilityBlocks)
      .set({ ...input, updatedById: userId })
      .where(where)
      .returning({ id: availabilityBlocks.id });
    if (!result.length) return { error: 'Availability block not found.' };

    revalidateAvailabilityViews();
    return { ok: true };
  });

export const archiveAvailabilityBlock = capabilityClient('availability:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const user = ctx.user;
    const userId = user.id;
    const userIsAdmin = isAdmin(user);

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid availability block id.' };

    let myCoachId: number | null = null;
    if (!userIsAdmin) {
      myCoachId = (await loadCurrentMembership())?.coachContactId ?? null;
      const [existing] = await db
        .select({ kind: availabilityBlocks.kind, coachId: availabilityBlocks.coachId })
        .from(availabilityBlocks)
        .where(and(eq(availabilityBlocks.id, id), isNull(availabilityBlocks.archivedAt)))
        .limit(1);
      if (!existing) return { error: 'Availability block not found.' };
      const ownsErr = await ensureAvailabilityOwnership(user, existing);
      if (ownsErr) return ownsErr;
    }

    // See updateAvailabilityBlock: non-admin archive WHERE pins kind + coach_id
    // to close the TOCTOU window between the ownership check and the write.
    const where =
      userIsAdmin
        ? and(eq(availabilityBlocks.id, id), isNull(availabilityBlocks.archivedAt))
        : and(
            eq(availabilityBlocks.id, id),
            isNull(availabilityBlocks.archivedAt),
            eq(availabilityBlocks.kind, 'coach_unavailable'),
            eq(availabilityBlocks.coachId, myCoachId!),
          );

    await db
      .update(availabilityBlocks)
      .set({ archivedAt: new Date(), updatedById: userId })
      .where(where);

    revalidateAvailabilityViews();
    return { ok: true };
  });

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
