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
  dealerActivities,
  dealerContacts,
  dealers,
  audienceSources,
  teamMemberRoles,
} from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { recordAudit } from '@/features/audit/actions';
import { getValidAccessToken } from '@/lib/quickbooks/connection';
import { findCustomerByDisplayName } from '@/lib/quickbooks/client';
import { type DealerToPush, pushDealerToQuickbooks } from '@/lib/quickbooks/dealer-push';
import { ensureAvailabilityOwnership } from './availability-authz';
import { reconcileCampaignCalendar } from './calendar-sync';
import { loadDealer } from './queries';
import { dealerFormSchema } from '@/features/dealers/dealer-schema';
import { dealerPipelineSchema, logActivitySchema } from '@/features/dealers/pipeline-schema';
import {
  type DuplicateResult,
  findExistingContactByIdentifier,
  findExistingDealerByNameAddress,
} from '@/features/dealers/dedup';
import { availabilityFormSchema } from './availability-schema';
import { lookupFormSchema } from './lookup-schema';
import { parseCampaignInput, parseId } from './validators';

type FieldErrors = Record<string, string[] | undefined>;
function firstFieldError(fieldErrors: FieldErrors): string | undefined {
  for (const list of Object.values(fieldErrors)) {
    if (list && list.length) return list[0];
  }
  return undefined;
}

type ActionResult =
  // `dealerId` is set only by `createDealer` so inline-create callers (the
  // booking dialog's "+ Add", chunk 0056) can auto-select the new dealer.
  // `campaignId` is set only by `createCampaign` (0093) so the booking dialog
  // can hand off into "Create quote now?". Both optional + ignored elsewhere.
  | { ok: true; dealerId?: number; campaignId?: number }
  // 0085: a create-time duplicate was detected; the action returns the match
  // (instead of throwing/blind-inserting) so the form can offer reuse/link.
  | { duplicate: DuplicateResult }
  | { error: string; fieldErrors?: Record<string, string[] | undefined> };
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

// 0085: the create-time dedup decision flags the client re-submits with after
// seeing a duplicate prompt. Read straight off FormData (control-plane, not
// dealer data) so `dealerFormSchema` stays focused on the dealer fields and the
// form's `zodResolver` doesn't grow phantom fields.
type DealerDecision = {
  createAnyway: boolean;
  reuseContactId: number | null;
  linkQuickbooksId: string | null;
};
function parseDealerDecision(formData: FormData): DealerDecision {
  const reuseRaw = formData.get('reuseContactId');
  const linkRaw = formData.get('linkQuickbooksId');
  return {
    createAnyway: formData.get('createAnyway') === '1',
    reuseContactId:
      typeof reuseRaw === 'string' && /^\d+$/.test(reuseRaw) ? Number(reuseRaw) : null,
    linkQuickbooksId:
      typeof linkRaw === 'string' && linkRaw.trim() ? linkRaw.trim() : null,
  };
}

// 0085 Phase 4: best-effort create-time QuickBooks check. Resolves to the
// matched Customer (Id + display name) when the new dealer's name already exists
// as a QBO Customer, or null when there's no match / QB is dormant / the query
// errors or exceeds the ceiling. NEVER throws — a QB outage must not block
// creating a dealer (mirrors `autoPushActiveDealerToQuickbooks`). The timeout
// bounds the live round-trip (token refresh + one query) so a slow QuickBooks
// degrades to "skip", not "hang the save".
const QB_NAME_CHECK_TIMEOUT_MS = 4000;
async function findQuickbooksCustomerMatch(
  name: string,
): Promise<{ quickbooksId: string; name: string } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const check = (async () => {
      const { realmId, accessToken } = await getValidAccessToken();
      const customer = await findCustomerByDisplayName(name, realmId, accessToken);
      return customer?.Id
        ? { quickbooksId: customer.Id, name: customer.DisplayName ?? name }
        : null;
    })();
    const timeout = new Promise<null>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('QBO name check timed out')),
        QB_NAME_CHECK_TIMEOUT_MS,
      );
    });
    return await Promise.race([check, timeout]);
  } catch {
    // best-effort: dormant connection, query error, or timeout → skip the check.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 0085: turn an identifier collision into an informational duplicate result
// naming the contact that already holds the email/phone, so the form can say
// "that email belongs to Jane Smith" instead of a generic toast. Read-only;
// runs after the tx has rolled back on the conflict.
async function contactDuplicateResult(
  err: IdentifierConflictError,
): Promise<{ duplicate: DuplicateResult } | null> {
  const match = await findExistingContactByIdentifier(
    err.kind === 'email' ? { email: err.value } : { phone: err.value },
  );
  if (!match) return null;
  return {
    duplicate: {
      kind: 'contact',
      via: err.kind,
      contactId: match.contactId,
      name: `${match.firstName} ${match.lastName}`.trim(),
      matchedValue: err.value,
    },
  };
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

/** Wire-format normalize before `safeParse`: `status=''` from a programmatic
 *  caller (no submit-side select widget setting a definite value) is treated
 *  as "absent" so the action's existing "omit status from patch / fall back to
 *  default" semantics kick in. The schema's `z.enum([...]).optional()` would
 *  otherwise reject the empty string. Kept out of the schema so the schema's
 *  input/output types stay aligned for `zodResolver` (zod's `preprocess` makes
 *  input `unknown` and clashes with RHF's type inference). */
function normalizeDealerWire(raw: Record<string, FormDataEntryValue>) {
  if (raw.status === '') delete raw.status;
  return raw;
}

// Best-effort app→QBO dealer push (chunk 0084). Mirrors the calendar
// best-effort pattern (0077): NEVER throws and NEVER blocks/rolls back the
// dealer write. When QuickBooks is connected, the dealer is pushed to its QBO
// Customer — `pushDealerToQuickbooks` takes the update branch (fresh SyncToken)
// for a linked dealer, or the create branch (+ link backfill) for an unlinked
// one. A dormant connection (`getValidAccessToken` throws) or any QBO write
// error (incl. a duplicate-name 6240 — D1: leave the dealer unlinked) is
// swallowed; the dealer saves regardless and can be reconciled later via the
// manual Push / Sync. Callers gate WHICH dealers reach here (active on create,
// active-or-linked on edit) — this helper just runs the push when called.
async function autoPushActiveDealerToQuickbooks(
  dealer: DealerToPush,
  actorId: string | null,
): Promise<void> {
  try {
    const { realmId, accessToken } = await getValidAccessToken();
    await pushDealerToQuickbooks(dealer, realmId, accessToken, actorId);
  } catch {
    // best-effort: a missing/erroring QuickBooks never blocks the dealer save.
  }
}

export const createDealer = capabilityClient('dealer:create')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const parsed = dealerFormSchema.safeParse(
      normalizeDealerWire(Object.fromEntries(formData)),
    );
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

    const decision = parseDealerDecision(formData);
    const wantsContact = !!(contactFirst || contactLast);

    // 0085 (eval hardening): only honor `reuseContactId` if it really is the
    // contact that holds the submitted email/phone — a re-submit must correspond
    // to a match the action actually surfaced, not a forged id linking an
    // arbitrary contact. On mismatch, drop the flag so the normal dedup flow
    // re-runs (and re-surfaces the real duplicate). The `linkQuickbooksId` twin
    // is parked (0085-a) — validating it needs a QB read that conflicts with the
    // best-effort principle.
    if (decision.reuseContactId != null) {
      const verify =
        contactEmail || contactPhone
          ? await findExistingContactByIdentifier({ email: contactEmail, phone: contactPhone })
          : null;
      if (verify?.contactId !== decision.reuseContactId) {
        decision.reuseContactId = null;
      }
    }

    // 0085 Phase 3: warn before creating a second dealer with the same
    // name+address (app-local — name+address is too fuzzy to enforce at the DB
    // level). Runs first (cheap local read). Skipped on `createAnyway` (a
    // deliberate same-name dealer at a different lot) and on `linkQuickbooksId`
    // (the QB-link prompt is only reached once this check already passed).
    if (!decision.createAnyway && decision.linkQuickbooksId == null) {
      const dealerMatch = await findExistingDealerByNameAddress(name, address || null);
      if (dealerMatch) {
        return {
          duplicate: {
            kind: 'dealer-local',
            dealerId: dealerMatch.dealerId,
            name: dealerMatch.name,
            address: dealerMatch.address,
          },
        };
      }
    }

    // 0085 Phase 2: warn before blind-inserting a contact whose email/phone
    // already belongs to another contact. Skipped once the coach has chosen to
    // reuse the match (`reuseContactId`) or to create anyway. The DB
    // active-uniqueness index is still the backstop on a create-anyway collision.
    if (
      !decision.createAnyway &&
      decision.reuseContactId == null &&
      wantsContact &&
      (contactEmail || contactPhone)
    ) {
      const match = await findExistingContactByIdentifier({
        email: contactEmail,
        phone: contactPhone,
      });
      if (match) {
        return {
          duplicate: {
            kind: 'contact',
            via: match.matchedKind,
            contactId: match.contactId,
            name: `${match.firstName} ${match.lastName}`.trim(),
            matchedValue: match.matchedValue,
          },
        };
      }
    }

    // 0085 Phase 4: catch the case app-local dedup can't see — a Customer that
    // exists directly in QuickBooks but was never pulled into the app, which
    // today saves an unlinked orphan because the auto-push swallows Intuit's
    // 6240. Only for an *active* dealer (prospects don't push to QB, so the
    // composer's inline prospect-create stays fast — no QB round-trip). Skipped
    // on `createAnyway` / `linkQuickbooksId`. Best-effort: a miss/outage → create.
    if (status === 'active' && !decision.createAnyway && decision.linkQuickbooksId == null) {
      const qbMatch = await findQuickbooksCustomerMatch(name);
      if (qbMatch) {
        return {
          duplicate: {
            kind: 'dealer-quickbooks',
            quickbooksId: qbMatch.quickbooksId,
            name: qbMatch.name,
          },
        };
      }
    }

    let newDealerId: number;
    try {
      newDealerId = await db.transaction(async (tx) => {
        const [dealerRow] = await tx
          .insert(dealers)
          .values({
            publicId: generatePublicId(),
            name,
            address: address || null,
            province: v.province || null,
            status,
            acquiredVia: acquiredVia as string | null,
            // 0085 Phase 4: born linked when the coach chose to link to an
            // existing QBO Customer, so the auto-push below takes the *update*
            // branch (no duplicate Customer created).
            ...(decision.linkQuickbooksId ? { quickbooksId: decision.linkQuickbooksId } : {}),
            createdById: userId,
            updatedById: userId,
          })
          .returning({ id: dealers.id });

        const reuseContactId = decision.reuseContactId;
        const hasContact = contactFirst || contactLast;
        if (!hasContact && reuseContactId == null) return dealerRow.id;

        // 0085 Phase 2: reuse links the existing contact (its name + identifiers
        // stay as they are — we only add the dealer link); otherwise insert a
        // fresh contact as before.
        let contactId: number;
        if (reuseContactId != null) {
          contactId = reuseContactId;
        } else {
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
        }

        await tx.insert(dealerContacts).values({
          dealerId: dealerRow.id,
          contactId,
          // First (and only) contact of a brand-new dealer → its primary (0089).
          isPrimary: true,
          source: 'admin',
          createdById: userId,
          updatedById: userId,
        });

        // 0023 Phase 4: every dealer-side contact gets a `dealer` team-member
        // role too, so the People-admin filter / People dialog can surface
        // them and Phase 5's "every contact has a role" invariant holds. 0085:
        // upsert (un-archive on conflict) so a *reused* contact that already
        // carries the role — possibly archived — doesn't trip the
        // `(contact_id, role)` unique index.
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

        // Reuse keeps the existing contact's identifiers untouched; only a
        // freshly inserted contact gets its primary email/phone set here.
        if (reuseContactId == null) {
          await swapPrimaryIdentifier(tx, contactId, 'email', contactEmail, userId);
          await swapPrimaryIdentifier(tx, contactId, 'phone', contactPhone, userId);
        }
        return dealerRow.id;
      });
    } catch (err) {
      return toActionResult(err);
    }

    // Best-effort: an active dealer auto-creates a QBO Customer + links (0084).
    // Prospects are not pushed (avoids cluttering QuickBooks with leads). Built
    // inline from the just-saved data — no extra read; never blocks the save.
    // 0085: on a *reused* contact the typed name/email may differ from the
    // contact actually linked, so reload to push the true denormalized values.
    if (status === 'active') {
      const toPush =
        decision.reuseContactId == null
          ? {
              id: newDealerId,
              name,
              address: address || null,
              province: v.province || null,
              // 0085 Phase 4: a born-linked dealer pushes via the update branch.
              quickbooksId: decision.linkQuickbooksId ?? null,
              // 0086: the UI create form has no rooftop-phone field; the Customer
              // phone falls back to the contact's. Imported prospects that carry
              // `dealers.phone` push it via `loadDealer` on activation/edit.
              phone: null,
              contactFirstName: contactFirst || null,
              contactLastName: contactLast || null,
              primaryEmail: contactEmail || null,
              primaryPhone: contactPhone || null,
            }
          : await loadDealer(newDealerId);
      if (toPush) await autoPushActiveDealerToQuickbooks(toPush, userId);
    }

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true, dealerId: newDealerId };
  });

export const updateDealer = capabilityClient('dealer:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid dealer id.' };

    const parsed = dealerFormSchema.safeParse(
      normalizeDealerWire(Object.fromEntries(formData)),
    );
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
    // Province is a patch: present (form always submits the select) → set the
    // code, or clear to null when the "none" option ('') is chosen; absent →
    // preserve. Drives quote sales tax (0065).
    const provincePatch = formData.has('province')
      ? (v.province || null)
      : undefined;

    const dealerPatch: Record<string, unknown> = {
      name,
      address: address || null,
      updatedById: userId,
    };
    if (statusPatch !== undefined) dealerPatch.status = statusPatch;
    if (acquiredViaPatch !== undefined) dealerPatch.acquiredVia = acquiredViaPatch;
    if (provincePatch !== undefined) dealerPatch.province = provincePatch;

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

      // Edit the dealer's primary contact in place (0089: the is_primary link,
      // falling back to the lowest-id link) rather than creating a duplicate —
      // matches the contact loadDealers displays.
      const links = await tx
        .select({ id: dealerContacts.id, contactId: dealerContacts.contactId, isPrimary: dealerContacts.isPrimary })
        .from(dealerContacts)
        .where(and(eq(dealerContacts.dealerId, id), isNull(dealerContacts.archivedAt)));
      const link = links.length
        ? (links.find((l) => l.isPrimary) ??
           links.reduce((best, cur) => (cur.id < best.id ? cur : best)))
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
          // This branch only runs when the dealer has no active link yet, so the
          // new contact is its primary (0089).
          isPrimary: true,
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
      // 0085 Phase 2 (D4): surface a contact-identifier collision as an
      // informational duplicate result ("that email belongs to Jane Smith")
      // rather than the generic toast. The tx already rolled back on the throw.
      if (err instanceof IdentifierConflictError) {
        const dup = await contactDuplicateResult(err);
        if (dup) return dup;
      }
      return toActionResult(err);
    }
    if (notFound) return { error: 'Dealer not found.' };

    // Best-effort: propagate the edit to QuickBooks so contact churn keeps the
    // linked Customer current (0084, D2 = active OR already-linked). A linked
    // dealer takes the push's update branch (fresh SyncToken); an active-but-
    // unlinked one takes the create branch (auto-link). Reload to get the
    // post-update status + denormalized contact name/email/phone.
    const edited = await loadDealer(id);
    if (edited && (edited.status === 'active' || edited.quickbooksId)) {
      await autoPushActiveDealerToQuickbooks(edited, userId);
    }

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true };
  });

// `createCoach` / `updateCoach` / `archiveCoach` retired in 0020 Phase 4 —
// the People page (`/admin/people`) handles all three via `createPerson` /
// `updatePerson` / `archivePerson` in `src/features/people/actions.ts`. The
// read path (`loadCoaches` in `queries.ts`) stays — it's used by `/calendar`,
// `/production`, `/share/coach/[id]`, and the booking-form coach picker.

// validation: skip — id-only action; `parseId` is the only input check.
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
// validation: skip — id-only action; `parseId` is the only input check.
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

      // Best-effort: the prospect just became a real customer → push to QBO
      // (0084). Only when the flip actually happened (idempotent no-op skips it).
      const activated = await loadDealer(id);
      if (activated) await autoPushActiveDealerToQuickbooks(activated, userId);
    }

    revalidatePath('/dealerships');
    revalidatePath('/production');
    return { ok: true };
  });

// ---------- Prospecting pipeline (0087) ----------

// Action-layer enforcement of the coaches-only owner picklist (decision D2): the
// `owner_id` FK stays generic `auth.users`, so a forged request could otherwise
// set any user as owner. Confirms the uuid belongs to an active coach.
async function ownerIsCoach(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .innerJoin(
      teamMemberRoles,
      and(
        eq(teamMemberRoles.contactId, contacts.id),
        eq(teamMemberRoles.role, 'coach'),
        isNull(teamMemberRoles.archivedAt),
      ),
    )
    .where(and(eq(contacts.userId, userId), isNull(contacts.archivedAt)))
    .limit(1);
  return !!row;
}

// Patch a dealer's pipeline fields (stage / priority / owner / next-action /
// due-date). Omit-when-absent like `updateDealer`: a field the form doesn't
// submit is preserved; a present-but-empty field clears to null — EXCEPT `stage`,
// where '' means "no change" (a prospect always carries a real stage). Stamps
// `stage_changed_at` only on a real transition (read by the 0088 dashboard's
// stalled-in-stage blocker). Locked once the dealer is `active` — winning leaves
// the funnel (won = `status='active'` via `convertProspectToActive`).
// validation: dealerPipelineSchema (safeParse over FormData).
export const setDealerPipeline = capabilityClient('dealer:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid dealer id.' };

    const parsed = dealerPipelineSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return { error: firstFieldError(fieldErrors) ?? 'Invalid pipeline input.', fieldErrors };
    }
    const v = parsed.data;

    // Coaches-only owner enforcement at the action layer (decision D2).
    const ownerIdPatch = formData.has('ownerId') ? v.ownerId || null : undefined;
    if (ownerIdPatch && !(await ownerIsCoach(ownerIdPatch))) {
      return { error: 'Owner must be a coach.' };
    }

    const patch: Record<string, unknown> = { updatedById: userId };
    const stagePatch = formData.has('stage') && v.stage ? v.stage : undefined;
    if (stagePatch !== undefined) patch.pipelineStage = stagePatch;
    if (formData.has('priority')) patch.priority = v.priority || null;
    if (ownerIdPatch !== undefined) patch.ownerId = ownerIdPatch;
    if (formData.has('nextAction')) patch.nextAction = v.nextAction || null;
    if (formData.has('nextActionAt')) patch.nextActionAt = v.nextActionAt || null;

    let notFound = false;
    let locked = false;
    let updated: { id: number }[] = [];
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ stage: dealers.pipelineStage, status: dealers.status })
        .from(dealers)
        .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)))
        .limit(1);
      if (!current) {
        notFound = true;
        return;
      }
      if (current.status === 'active') {
        locked = true;
        return;
      }
      if (stagePatch !== undefined && stagePatch !== current.stage) {
        patch.stageChangedAt = new Date();
      }
      // Guard on status='prospect' so a `convertProspectToActive` that commits
      // between the read above and this write can't slip a pipeline edit onto a
      // now-active dealer (TOCTOU). Zero rows back ⇒ it flipped under us.
      updated = await tx
        .update(dealers)
        .set(patch)
        .where(and(eq(dealers.id, id), eq(dealers.status, 'prospect'), isNull(dealers.archivedAt)))
        .returning({ id: dealers.id });
    });
    if (notFound) return { error: 'Dealer not found.' };
    if (locked || !updated.length) {
      return { error: 'Pipeline is locked once a dealer is active.' };
    }

    revalidatePath('/dealerships');
    return { ok: true };
  });

// Log a touch on a dealer (call / email / meeting / note / other): inserts a
// `dealer_activities` row, stamps `dealers.last_contacted_at` to the touch time,
// and optionally sets the next promise in the same submit. Does NOT append to
// `dealers.notes` (decision.md D4 — the activity log is the trail).
// validation: logActivitySchema (safeParse over FormData).
export const logDealerActivity = capabilityClient('dealer:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid dealer id.' };

    const parsed = logActivitySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return { error: firstFieldError(fieldErrors) ?? 'Invalid activity input.', fieldErrors };
    }
    const v = parsed.data;
    // Backdated touches anchor at noon UTC so the calendar date is stable across
    // timezones; default to now when no date is supplied.
    const occurredAt = v.occurredAt ? new Date(`${v.occurredAt}T12:00:00Z`) : new Date();

    let notFound = false;
    await db.transaction(async (tx) => {
      // Touch the dealer first, guarded on `archivedAt IS NULL` — if a concurrent
      // archive committed, zero rows come back and we skip the insert rather than
      // orphan an activity on an archived dealer.
      const dealerPatch: Record<string, unknown> = {
        lastContactedAt: occurredAt,
        updatedById: userId,
      };
      if (formData.has('nextAction')) dealerPatch.nextAction = v.nextAction || null;
      if (formData.has('nextActionAt')) dealerPatch.nextActionAt = v.nextActionAt || null;
      const touched = await tx
        .update(dealers)
        .set(dealerPatch)
        .where(and(eq(dealers.id, id), isNull(dealers.archivedAt)))
        .returning({ id: dealers.id });
      if (!touched.length) {
        notFound = true;
        return;
      }

      await tx.insert(dealerActivities).values({
        dealerId: id,
        kind: v.kind,
        note: (v.note ?? '') || null,
        occurredAt,
        createdById: userId,
        updatedById: userId,
      });
    });
    if (notFound) return { error: 'Dealer not found.' };

    revalidatePath('/dealerships');
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

    const [created] = await db
      .insert(campaigns)
      .values({
        publicId: generatePublicId(),
        status: 'booked',
        createdById: userId,
        updatedById: userId,
        ...input,
      })
      .returning({ id: campaigns.id });

    // Best-effort Google Calendar projection (0077) — never blocks the booking.
    await reconcileCampaignCalendar(created.id, userId);

    revalidateCampaignViews();
    // 0093: surface the new campaign so the booking dialog can hand off into
    // "Create quote now?" (prefill the composer with this event + its dealer).
    return { ok: true, campaignId: created.id, dealerId: input.dealerId };
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

    // Re-project the edited event (date/coach/dealer changes patch in place).
    await reconcileCampaignCalendar(id, userId);

    revalidateCampaignViews();
    return { ok: true };
  });

// validation: skip — id-only action; `parseId` is the only input check.
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

    // Remove the projected event everywhere (best-effort).
    await reconcileCampaignCalendar(id, userId);

    revalidateCampaignViews();
    return { ok: true };
  });

// Manual re-sync of a single campaign's calendar event — the recovery path when
// a best-effort sync failed (`gcal_sync_status = 'failed'`). Idempotent: it just
// re-runs the same reconcile the mutations call. Admin/editor-gated like edit.
// validation: skip — id-only action; `parseId` is the only input check.
export const resyncCampaign = capabilityClient('campaign:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const id = parseId(formData);
    if (id == null) return { error: 'Invalid campaign id.' };

    const outcome = await reconcileCampaignCalendar(id, ctx.user.id);
    revalidateCampaignViews();
    if (outcome === 'missing') return { error: 'Campaign not found.' };
    if (outcome === 'failed') {
      return {
        error:
          'Calendar sync failed — the campaign is saved, but Google Calendar could not be updated. Try again shortly.',
      };
    }
    if (outcome === 'skipped') {
      return { error: 'Google Calendar sync is not configured for this environment.' };
    }
    return { ok: true };
  });

// 0100: per-event MSA opt-out. Flips `campaigns.msa_waived` so the event reads
// as "MSA — Not required" (no exposed flag / "Send MSA" CTA from the MSA side)
// and its quote can be accepted with no active MSA. Reversible — un-waiving
// restores the normal "No active MSA" nag + re-arms the accept gate. Gated on
// `campaign:edit` (admin-only in this app — booking is back-office, matching the
// adjacent Edit / Re-sync / Send-MSA controls); the MSA stays a per-client
// 12-month master agreement — this only opts one event out. Guarded UPDATE on
// the campaign id so a bad/foreign id is a no-op error, not a crash. No calendar
// re-projection (date/coach/dealer unchanged), and — like the sibling
// `updateCampaign`/`resyncCampaign` edits — no audit-log row (`updated_by_id`
// captures the actor; auditing would need a new audit-enum value + migration).
// validation: skip — id + boolean flag only; `parseId` covers the id and the
// flag is a strict 'true' check.
export const setMsaWaived = capabilityClient('campaign:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const id = parseId(formData);
    if (id == null) return { error: 'Invalid campaign id.' };

    const waived = formData.get('waived') === 'true';

    const result = await db
      .update(campaigns)
      .set({ msaWaived: waived, updatedById: userId })
      .where(eq(campaigns.id, id))
      .returning({ id: campaigns.id });
    if (!result.length) return { error: 'Campaign not found.' };

    revalidateCampaignViews();
    return { ok: true };
  });

// ---------- Lookups (5.3) ----------

function parseLookupLabel(formData: FormData): string | ActionResult {
  const parsed = lookupFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: firstFieldError(fieldErrors) ?? 'Invalid lookup input.',
      fieldErrors,
    };
  }
  return parsed.data.label;
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

// validation: skip — id-only action; `parseId` is the only input check.
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

// validation: skip — id-only action; `parseId` is the only input check.
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

// validation: skip — id-only action; `parseId` is the only input check.
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
