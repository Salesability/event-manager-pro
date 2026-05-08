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
import { assertCan } from '@/lib/auth/assert-can';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/features/audit/actions';
import { EMAIL_RE, field, parseOptionalId } from '@/features/schedule/validators';

// Three-state result so the UI can distinguish a clean success from a partial
// success — e.g. the contact committed but the auth-side `auth.admin.createUser`
// failed, which leaves a real DB row the admin needs to see in the table even
// though the operation didn't fully succeed. Codex Medium follow-up to the
// 0020 Phase 3 eval.
type ActionResult =
  | { ok: true; contactId?: number; warning?: string }
  | { error: string };

// V1 us-side roles surfaced in the UI. `staff` and `viewer` stay reserved per
// the 0018 plan decision (auth.md "v1 wired roles"). `dealer` was added by
// 0023 Phase 1 to gate the Dealers section in the Person edit dialog and to
// keep the "every contact has a role" invariant truthful for dealer-side
// staff (who previously had no team_member_roles row at all).
const V1_TEAM_ROLES = ['admin', 'coach', 'dealer'] as const;
type V1TeamRole = (typeof V1_TEAM_ROLES)[number];

// Roles that imply staff-app sign-in (and thus require an `auth.users` row +
// an `appAccess=1` form field). `dealer` is excluded — dealer-side staff are
// them-side and don't get app access. Mirrors `STAFF_APP_ROLES` in
// src/lib/auth/load-team-membership.ts; the auth-side gate filters dealer
// out of staff routing for the same reason.
const ROLES_REQUIRING_APP_ACCESS: ReadonlySet<V1TeamRole> = new Set([
  'admin',
  'coach',
]);

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
  // Map common Postgres error codes that bubble up from Drizzle to friendly
  // messages so the admin sees a toast, not a server-action stack trace.
  // Codes: 22P02 invalid_text_representation (e.g. malformed UUID), 23503
  // foreign_key_violation (auth.users.id missing), 23505 unique_violation
  // (race-into `contacts_user_id_unique` etc.).
  if (typeof err === 'object' && err != null) {
    const code = (err as { code?: string }).code;
    if (code === '22P02') return { error: 'Invalid id format.' };
    if (code === '23503') {
      return { error: 'Referenced row no longer exists. Refresh the page.' };
    }
    if (code === '23505') {
      return {
        error:
          'Another writer just made the same change. Refresh and check the row.',
      };
    }
  }
  throw err;
}

// Supabase auth.users.id is a v4 UUID. Validate format before letting Postgres
// reject it with a less-friendly 22P02 — saves a round-trip and produces a
// cleaner message even if the DB layer's error mapping changes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidatePeopleViews() {
  revalidatePath('/admin/people');
  revalidatePath('/admin/users');
  // Coach views read from team_member_roles too.
  revalidatePath('/calendar');
  revalidatePath('/dealerships');
  revalidatePath('/production');
}

// ---------- FormData parsers ----------

function parseRolesField(formData: FormData): V1TeamRole[] | { error: string } {
  const raw = formData.getAll('roles').map((v) => String(v));
  for (const r of raw) {
    if (!V1_TEAM_ROLES.includes(r as V1TeamRole)) {
      return {
        error: `Role '${r}' is not selectable in v1 (admin, coach, dealer only).`,
      };
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
  await assertCan('person:create');

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
  // 0023 Phase 5 invariant: every contact has at least one role. Mirrors
  // the form-level ≥1-role guard at `people-admin.tsx`; the action-layer
  // assertion is load-bearing because Server Actions are public-API-shaped
  // (see 0019 Phase 2 finding) — a direct POST bypasses the form. The
  // `adoptOrphanAuthUser` legacy-recovery path is the documented carve-out;
  // see docs/wiki/data-model.md.
  if (roles.length === 0) {
    return { error: 'At least one role is required.' };
  }
  // createPerson rejects (vs updatePerson's silent coerce) because here the
  // admin is in the act of setting up the row: an explicit error is more
  // helpful than silently dropping the role. Only the staff-app-implying
  // roles trigger the rejection — `dealer` is an "external contact" role
  // and creates a contacts row without an auth.users row.
  if (
    !appAccess &&
    roles.some((r) => ROLES_REQUIRING_APP_ACCESS.has(r))
  ) {
    return {
      error: 'App access is required to assign Admin or Coach roles.',
    };
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

  // Audit the role grant. We emit even if the auth-side step below fails —
  // the role rows are already committed, and that's the auditable event. The
  // forensic intent is "the admin granted these roles to this contact."
  if (roles.length > 0) {
    await recordAudit({
      action: 'user.role_changed',
      targetTable: 'contacts',
      targetId: newContactId,
      payload: { before: [], after: [...roles].sort() },
    });
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
      revalidatePeopleViews();
      return {
        ok: true,
        contactId: newContactId,
        warning: `Person created, but app access did not provision: ${
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
        revalidatePeopleViews();
        return {
          error:
            'Auth user provisioning raced with another writer; the new auth user has been disabled. Refresh and check the People page.',
        };
      }
    }

    if (roles.length > 0) {
      const result = await syncAuthMetadata(authUserId, roles);
      if ('error' in result) {
        revalidatePeopleViews();
        return { ok: true, contactId: newContactId, warning: result.error };
      }
    }
  }

  revalidatePeopleViews();
  return { ok: true, contactId: newContactId };
}

export async function updatePerson(formData: FormData): Promise<ActionResult> {
  await assertCan('person:edit');

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
  // `dealer` survives — it doesn't require app access, so it's preserved
  // even when the appAccess flag is off.
  const roles = appAccess
    ? rolesParsed
    : rolesParsed.filter((r) => !ROLES_REQUIRING_APP_ACCESS.has(r));
  // 0023 Phase 5 invariant: every contact has at least one role. The
  // form-level guard rejects empty submissions, but a direct POST or a
  // stale-form submission could still reach here with no roles after
  // coercion (e.g. appAccess=off + roles=['admin'] coerces to []).
  if (roles.length === 0) {
    return { error: 'At least one role is required.' };
  }

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

  // Closure-captured role diff for the post-tx audit emit. The snapshot read
  // lives INSIDE the tx so a concurrent `updatePerson` between the read and
  // `syncTeamMemberRoles` can't make `before` inaccurate.
  let existingRoles: string[] = [];
  let desiredRoles: string[] = [];
  let rolesChanged = false;

  try {
    await db.transaction(async (tx) => {
      const existingRoleRows = await tx
        .select({ role: teamMemberRoles.role })
        .from(teamMemberRoles)
        .where(
          and(
            eq(teamMemberRoles.contactId, contactId),
            isNull(teamMemberRoles.archivedAt),
          ),
        );
      existingRoles = existingRoleRows.map((r) => r.role).sort();
      desiredRoles = [...roles].sort();
      rolesChanged =
        existingRoles.length !== desiredRoles.length ||
        existingRoles.some((r, i) => r !== desiredRoles[i]);

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
      revalidatePeopleViews();
      return {
        ok: true,
        contactId,
        warning: `Person updated, but app access did not provision: ${
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
      revalidatePeopleViews();
      return {
        error:
          'App access was just provisioned by another admin. Refresh and re-check the row.',
      };
    }

    if (roles.length > 0) {
      const result = await syncAuthMetadata(authUserId, roles);
      if ('error' in result) {
        revalidatePeopleViews();
        return { ok: true, contactId, warning: result.error };
      }
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
      revalidatePeopleViews();
      return {
        ok: true,
        contactId,
        warning: `Person updated, but auth ban failed: ${error.message}.`,
      };
    }
    await recordAudit({
      action: 'user.deactivated',
      targetTable: 'contacts',
      targetId: contactId,
      payload: { authUserId: current.userId, via: 'updatePerson' },
    });
  } else if (appAccess && current.userId != null) {
    // Already linked. Lift any active ban first (idempotent on already-active
    // users) — this is the restore path when an earlier accidental ban is
    // reversed by re-ticking a role on Edit. Sync the email here too: prior
    // to 2026-05-07 the contact_identifiers email updated correctly but
    // `auth.users.email` stayed at the original provisioning value, so the
    // person could only sign in with the old email. `email_confirm: true`
    // skips Supabase's user-confirmation flow — admin override semantics.
    // Then keep app_metadata.role in sync with the role set.
    const { error: updateErr } = await admin.auth.admin.updateUserById(
      current.userId,
      {
        ban_duration: 'none',
        ...(email ? { email, email_confirm: true } : {}),
      },
    );
    if (updateErr) {
      revalidatePeopleViews();
      return {
        ok: true,
        contactId,
        warning: `Person updated, but auth-side update failed: ${updateErr.message}.`,
      };
    }
    const result = await syncAuthMetadata(current.userId, roles);
    if ('error' in result) {
      revalidatePeopleViews();
      return { ok: true, contactId, warning: result.error };
    }
  }

  if (rolesChanged) {
    await recordAudit({
      action: 'user.role_changed',
      targetTable: 'contacts',
      targetId: contactId,
      payload: { before: existingRoles, after: desiredRoles },
    });
  }

  revalidatePeopleViews();
  return { ok: true, contactId };
}

export async function archivePerson(formData: FormData): Promise<ActionResult> {
  const adminUser = await assertCan('person:archive');

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
      revalidatePeopleViews();
      return {
        ok: true,
        contactId,
        warning: `Person archived, but auth ban failed: ${error.message}.`,
      };
    }
  }

  await recordAudit({
    action: 'user.deactivated',
    targetTable: 'contacts',
    targetId: contactId,
    payload: { authUserId: current.userId },
  });

  revalidatePeopleViews();
  return { ok: true, contactId };
}

// Adopt an orphan auth user — an `auth.users` row that has no matching
// `contacts.user_id`. Materializes a contacts row + email identifier, then
// links via `contacts.user_id`. Exception path for the Tilley-style legacy
// state and for any future Supabase-dashboard fallback path. The People
// page surfaces orphans in a small bottom panel; this action takes a row.
export async function adoptOrphanAuthUser(formData: FormData): Promise<ActionResult> {
  await assertCan('person:adopt-orphan');

  const userId = field(formData, 'userId');
  const firstName = field(formData, 'firstName');
  const lastName = field(formData, 'lastName');
  const email = field(formData, 'email').toLowerCase();
  if (!userId || !UUID_RE.test(userId)) return { error: 'Invalid auth user id.' };
  if (!firstName || !lastName) {
    return { error: 'First and last name are both required to adopt this user.' };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { error: 'Email looks invalid.' };
  }

  // Refuse if a contact is already linked to this auth user.
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), isNull(contacts.archivedAt)))
    .limit(1);
  if (existing) {
    return { error: `This auth user is already linked to contact ${existing.id}.` };
  }

  let newContactId: number;
  try {
    newContactId = await db.transaction(async (tx) => {
      const [contactRow] = await tx
        .insert(contacts)
        .values({ firstName, lastName, userId })
        .returning({ id: contacts.id });
      if (email) await swapPrimaryIdentifier(tx, contactRow.id, 'email', email);
      return contactRow.id;
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePeopleViews();
  return { ok: true, contactId: newContactId };
}
