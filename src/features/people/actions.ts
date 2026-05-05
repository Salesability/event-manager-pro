'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contactIdentifiers,
  contacts,
  dealerContacts,
  teamMemberRoles,
} from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { EMAIL_RE, field, parseOptionalId } from '@/features/schedule/validators';

type ActionResult = { ok: true; contactId?: number } | { error: string };

// V1 us-side roles surfaced in the UI. `staff` and `viewer` stay reserved per
// the 0018 plan decision (auth.md "v1 wired roles").
const V1_TEAM_ROLES = ['admin', 'coach'] as const;
type V1TeamRole = (typeof V1_TEAM_ROLES)[number];

const DEALER_CONTACT_ROLES = ['customer', 'staff', 'prospect'] as const;
type DealerContactRole = (typeof DEALER_CONTACT_ROLES)[number];

type DealerLinkInput = { dealerId: number; role: DealerContactRole };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

function revalidatePeopleViews() {
  revalidatePath('/admin/people');
  revalidatePath('/admin/users');
  // Coach views read from team_member_roles too.
  revalidatePath('/calendar');
  revalidatePath('/lists');
  revalidatePath('/production');
}

// ---------- FormData parsers ----------

function parseRolesField(formData: FormData): V1TeamRole[] | { error: string } {
  const raw = formData.getAll('roles').map((v) => String(v));
  for (const r of raw) {
    if (!V1_TEAM_ROLES.includes(r as V1TeamRole)) {
      return { error: `Role '${r}' is not selectable in v1 (admin and coach only).` };
    }
  }
  return Array.from(new Set(raw)) as V1TeamRole[];
}

function parseDealerLinksField(
  formData: FormData,
): DealerLinkInput[] | { error: string } {
  // Encoded as repeated `dealerLinks=<dealerId>:<role>` form fields. Avoids
  // JSON-in-FormData and matches how `roles` is shaped.
  const raw = formData.getAll('dealerLinks').map((v) => String(v));
  const out: DealerLinkInput[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const [dealerIdStr, role] = entry.split(':');
    const dealerId = Number(dealerIdStr);
    if (!Number.isInteger(dealerId) || dealerId <= 0) {
      return { error: `Invalid dealer link: '${entry}'.` };
    }
    if (!DEALER_CONTACT_ROLES.includes(role as DealerContactRole)) {
      return { error: `Invalid dealer-contact role: '${role}'.` };
    }
    const key = `${dealerId}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dealerId, role: role as DealerContactRole });
  }
  return out;
}

// ---------- Identifier helper ----------

// Matches the shape of `swapPrimaryIdentifier` in
// `src/features/schedule/actions.ts:718`. Duplicated here intentionally for
// the duration of 0020 — Phase 4 deletes `createCoach` / `updateCoach` /
// `archiveCoach`, at which point the schedule helper has only one consumer
// and can be retired or moved to a shared `src/lib/db/` module.
async function swapPrimaryIdentifier(
  tx: Tx,
  contactId: number,
  kind: 'email' | 'phone',
  newValue: string,
) {
  const [existing] = await tx
    .select({ id: contactIdentifiers.id, value: contactIdentifiers.value })
    .from(contactIdentifiers)
    .where(
      and(
        eq(contactIdentifiers.contactId, contactId),
        eq(contactIdentifiers.kind, kind),
        eq(contactIdentifiers.isPrimary, true),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .limit(1);

  if (!newValue) {
    if (existing) {
      await tx
        .update(contactIdentifiers)
        .set({ archivedAt: new Date(), isPrimary: false })
        .where(eq(contactIdentifiers.id, existing.id));
    }
    return;
  }

  if (existing && existing.value === newValue) return;

  // Pre-check the global active-uniqueness index so a clash surfaces as a
  // friendly toast instead of a Postgres constraint error.
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
      .set({ archivedAt: new Date(), isPrimary: false })
      .where(eq(contactIdentifiers.id, existing.id));
  }

  await tx.insert(contactIdentifiers).values({
    contactId,
    kind,
    value: newValue,
    isPrimary: true,
    source: 'admin-people',
  });
}

// ---------- Role-set sync (lifted from 0018's applyRoleSet, simplified to a tx callback) ----------

async function syncTeamMemberRoles(
  tx: Tx,
  contactId: number,
  desired: V1TeamRole[],
) {
  const existing = await tx
    .select({
      id: teamMemberRoles.id,
      role: teamMemberRoles.role,
      archivedAt: teamMemberRoles.archivedAt,
    })
    .from(teamMemberRoles)
    .where(eq(teamMemberRoles.contactId, contactId));

  const desiredSet = new Set<string>(desired);
  const existingByRole = new Map(existing.map((r) => [r.role, r]));

  for (const role of desired) {
    const row = existingByRole.get(role);
    if (!row) {
      await tx.insert(teamMemberRoles).values({ contactId, role });
    } else if (row.archivedAt != null) {
      await tx
        .update(teamMemberRoles)
        .set({ archivedAt: null })
        .where(eq(teamMemberRoles.id, row.id));
    }
  }

  const toArchive = existing
    .filter(
      (r) =>
        r.archivedAt == null &&
        !desiredSet.has(r.role) &&
        (V1_TEAM_ROLES as readonly string[]).includes(r.role),
    )
    .map((r) => r.id);
  if (toArchive.length) {
    await tx
      .update(teamMemberRoles)
      .set({ archivedAt: new Date() })
      .where(inArray(teamMemberRoles.id, toArchive));
  }
}

// ---------- Dealer-link sync ----------

async function syncDealerLinks(
  tx: Tx,
  contactId: number,
  desired: DealerLinkInput[],
) {
  const existing = await tx
    .select({
      id: dealerContacts.id,
      dealerId: dealerContacts.dealerId,
      role: dealerContacts.role,
      archivedAt: dealerContacts.archivedAt,
    })
    .from(dealerContacts)
    .where(eq(dealerContacts.contactId, contactId));

  const desiredKey = (l: DealerLinkInput) => `${l.dealerId}:${l.role}`;
  const existingKey = (l: { dealerId: number; role: DealerContactRole }) =>
    `${l.dealerId}:${l.role}`;

  const desiredKeys = new Set(desired.map(desiredKey));
  const existingByKey = new Map(existing.map((l) => [existingKey(l), l]));

  for (const want of desired) {
    const row = existingByKey.get(desiredKey(want));
    if (!row) {
      await tx.insert(dealerContacts).values({
        contactId,
        dealerId: want.dealerId,
        role: want.role,
        source: 'admin-people',
      });
    } else if (row.archivedAt != null) {
      await tx
        .update(dealerContacts)
        .set({ archivedAt: null })
        .where(eq(dealerContacts.id, row.id));
    }
  }

  const toArchive = existing
    .filter((r) => r.archivedAt == null && !desiredKeys.has(existingKey(r)))
    .map((r) => r.id);
  if (toArchive.length) {
    await tx
      .update(dealerContacts)
      .set({ archivedAt: new Date() })
      .where(inArray(dealerContacts.id, toArchive));
  }
}

// ---------- Auth-side helpers ----------

// Set or clear `app_metadata.role` on the auth user. Admin → 'admin', else
// null. Mirrors the 0018 hybrid storage decision (auth.md "Two surfaces").
async function syncAuthMetadata(authUserId: string, roles: V1TeamRole[]) {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    app_metadata: { role: roles.includes('admin') ? 'admin' : null },
  });
  if (error) {
    return {
      error: `Roles saved, but the auth gate did not update: ${error.message}. Re-submit to retry.`,
    };
  }
  return { ok: true } as const;
}

// ---------- Server Actions ----------

export async function createPerson(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const firstName = field(formData, 'firstName');
  const lastName = field(formData, 'lastName');
  const email = field(formData, 'email').toLowerCase();
  const phone = field(formData, 'phone');
  const appAccess = field(formData, 'appAccess') === '1';

  if (!firstName || !lastName) {
    return { error: 'First and last name are both required.' };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { error: 'Email looks invalid.' };
  }
  if (appAccess && !email) {
    return { error: 'Email is required when granting app access.' };
  }

  const roles = parseRolesField(formData);
  if ('error' in roles) return roles;
  if (roles.length > 0 && !appAccess) {
    // createPerson rejects (vs updatePerson's silent coerce) because here the
    // admin is in the act of setting up the row: an explicit error is more
    // helpful than silently dropping the role.
    return { error: 'App access is required to assign roles.' };
  }

  const dealerLinks = parseDealerLinksField(formData);
  if ('error' in dealerLinks) return dealerLinks;

  // Step 1: Drizzle transaction for the contact + identifiers + roles +
  // dealer links. Auth user comes after — see plan Decision 2.
  let newContactId: number;
  try {
    newContactId = await db.transaction(async (tx) => {
      const [contactRow] = await tx
        .insert(contacts)
        .values({ firstName, lastName })
        .returning({ id: contacts.id });

      if (email) await swapPrimaryIdentifier(tx, contactRow.id, 'email', email);
      if (phone) await swapPrimaryIdentifier(tx, contactRow.id, 'phone', phone);

      if (roles.length > 0) {
        await syncTeamMemberRoles(tx, contactRow.id, roles);
      }
      if (dealerLinks.length > 0) {
        await syncDealerLinks(tx, contactRow.id, dealerLinks);
      }

      return contactRow.id;
    });
  } catch (err) {
    return toActionResult(err);
  }

  // Step 2: Auth user. Best-effort — the contact + roles are already
  // committed. If this fails, surface a partial-success error so the admin
  // can either retry "Grant app access" from Edit Person, or delete the row.
  if (appAccess) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) {
      return {
        error: `Person created, but app access did not provision: ${
          error?.message ?? 'unknown error'
        }. Open the row and retry.`,
      };
    }
    const authUserId = data.user.id;

    // Conditional UPDATE — the 0002 trigger may already have set user_id by
    // matching the email identifier we just inserted. RETURNING distinguishes
    // "we won the link" (1 row) from "trigger or another writer beat us"
    // (0 rows). On 0 rows, verify the contact is linked to *our* auth user
    // (trigger path = same outcome) before declaring success; otherwise the
    // contact is linked to someone else and we must ban this stray auth user.
    const claimed = await db
      .update(contacts)
      .set({ userId: authUserId })
      .where(and(eq(contacts.id, newContactId), isNull(contacts.userId)))
      .returning({ id: contacts.id });

    if (claimed.length === 0) {
      const [linkedNow] = await db
        .select({ userId: contacts.userId })
        .from(contacts)
        .where(eq(contacts.id, newContactId))
        .limit(1);
      if (linkedNow?.userId !== authUserId) {
        await admin.auth.admin.updateUserById(authUserId, {
          ban_duration: '876000h',
          app_metadata: { role: null },
        });
        return {
          error:
            'Auth user provisioning raced with another writer; the new auth user has been disabled. Refresh and check the People page.',
        };
      }
    }

    if (roles.length > 0) {
      const result = await syncAuthMetadata(authUserId, roles);
      if ('error' in result) return result;
    }
  }

  revalidatePeopleViews();
  return { ok: true, contactId: newContactId };
}

export async function updatePerson(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const contactId = parseOptionalId(formData, 'contactId');
  if (contactId == null) return { error: 'Invalid contact id.' };

  const firstName = field(formData, 'firstName');
  const lastName = field(formData, 'lastName');
  const email = field(formData, 'email').toLowerCase();
  const phone = field(formData, 'phone');
  const appAccess = field(formData, 'appAccess') === '1';

  if (!firstName || !lastName) {
    return { error: 'First and last name are both required.' };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { error: 'Email looks invalid.' };
  }

  const rolesParsed = parseRolesField(formData);
  if ('error' in rolesParsed) return rolesParsed;

  const dealerLinks = parseDealerLinksField(formData);
  if ('error' in dealerLinks) return dealerLinks;

  // Coerce: a person without app access cannot hold staff-side roles.
  // This catches stale-UI submissions that send `roles=coach` while flipping
  // App access off — without it, the role row would survive the auth-side
  // ban and leave a dangling `team_member_roles(role='coach')` pointing at a
  // banned auth user. Server is the source of truth; UI is hint-only.
  const roles = appAccess ? rolesParsed : [];

  // Look up current state — needed for the appAccess transition + the
  // not-archived guard.
  const [current] = await db
    .select({
      id: contacts.id,
      userId: contacts.userId,
      archivedAt: contacts.archivedAt,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!current || current.archivedAt != null) {
    return { error: 'Person not found.' };
  }

  if (appAccess && !email && current.userId == null) {
    return { error: 'Email is required when granting app access.' };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({ firstName, lastName })
        .where(eq(contacts.id, contactId));

      await swapPrimaryIdentifier(tx, contactId, 'email', email);
      await swapPrimaryIdentifier(tx, contactId, 'phone', phone);

      await syncTeamMemberRoles(tx, contactId, roles);
      await syncDealerLinks(tx, contactId, dealerLinks);
    });
  } catch (err) {
    return toActionResult(err);
  }

  // Auth-side transitions, after the DB is consistent.
  const admin = createAdminClient();
  if (appAccess && current.userId == null) {
    // off → on: provision the auth user, then *atomically* claim the contact
    // via a conditional UPDATE that doubles as the race detector. Two admins
    // racing the same off→on submission would each succeed at
    // `auth.admin.createUser` (Supabase happily creates two distinct users
    // with two distinct emails); the `WHERE user_id IS NULL` clause means
    // exactly one wins the link. The loser must compensate by banning the
    // auth user it just minted — otherwise an unlinked auth user could still
    // pass `requireAdmin` if `app_metadata.role` got set.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) {
      return {
        error: `Person updated, but app access did not provision: ${
          error?.message ?? 'unknown error'
        }. Retry from Edit Person.`,
      };
    }
    const authUserId = data.user.id;
    const claimed = await db
      .update(contacts)
      .set({ userId: authUserId })
      .where(and(eq(contacts.id, contactId), isNull(contacts.userId)))
      .returning({ id: contacts.id });

    if (claimed.length === 0) {
      // Lost the race. The contact already has a different user_id (set by a
      // concurrent admin's createUser, or the 0002 trigger if a fresh email
      // identifier match happened mid-flight). Ban + clear metadata on the
      // auth user we just created so it can never be used as a sign-in path.
      await admin.auth.admin.updateUserById(authUserId, {
        ban_duration: '876000h',
        app_metadata: { role: null },
      });
      return {
        error:
          'App access was just provisioned by another admin. Refresh and re-check the row.',
      };
    }

    if (roles.length > 0) {
      const result = await syncAuthMetadata(authUserId, roles);
      if ('error' in result) return result;
    }
  } else if (!appAccess && current.userId != null) {
    // on → off: ban the auth user (Supabase soft-delete idiom). Don't drop
    // contacts.user_id — keeping the FK preserves historical audit trails on
    // any record this user previously created (`actor_id` columns).
    const { error } = await admin.auth.admin.updateUserById(current.userId, {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
    if (error) {
      return {
        error: `Person updated, but auth ban failed: ${error.message}.`,
      };
    }
  } else if (appAccess && current.userId != null) {
    // Already on; just keep app_metadata.role in sync with the role set.
    const result = await syncAuthMetadata(current.userId, roles);
    if ('error' in result) return result;
  }

  revalidatePeopleViews();
  return { ok: true, contactId };
}

export async function archivePerson(formData: FormData): Promise<ActionResult> {
  const adminUser = await requireAdmin();

  const contactId = parseOptionalId(formData, 'contactId');
  if (contactId == null) return { error: 'Invalid contact id.' };

  const [current] = await db
    .select({
      id: contacts.id,
      userId: contacts.userId,
      archivedAt: contacts.archivedAt,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!current || current.archivedAt != null) {
    return { error: 'Person not found.' };
  }
  if (current.userId === adminUser.id) {
    return { error: 'You cannot archive your own account.' };
  }

  // Archive the *relationships*, not the master record. Per
  // `docs/wiki/lifecycle.md`, the `contacts` row stays active so historical
  // FKs (`campaigns.coach_id`, share-link routes, audit columns) keep
  // resolving — the archived role/dealer-link rows are what stop the person
  // from being picked for new assignments.
  await db.transaction(async (tx) => {
    await tx
      .update(teamMemberRoles)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(teamMemberRoles.contactId, contactId),
          isNull(teamMemberRoles.archivedAt),
        ),
      );
    await tx
      .update(dealerContacts)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(dealerContacts.contactId, contactId),
          isNull(dealerContacts.archivedAt),
        ),
      );
  });

  // If the person had app access, ban the auth user too. Same Supabase soft-
  // delete idiom as `deactivateUser` (auth.md → Provisioning).
  if (current.userId != null) {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(current.userId, {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
    if (error) {
      return {
        error: `Person archived, but auth ban failed: ${error.message}.`,
      };
    }
  }

  revalidatePeopleViews();
  return { ok: true, contactId };
}
