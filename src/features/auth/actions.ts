'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, teamMemberRoles } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/url';
import { EMAIL_RE, field } from '@/features/schedule/validators';

type ActionResult = { ok: true } | { error: string };

const V1_TEAM_ROLES = ['admin', 'coach'] as const;
type V1TeamRole = (typeof V1_TEAM_ROLES)[number];

async function siteUrl() {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const next = safeNextPath(formData.get('next'));

  if (!email) {
    redirect('/login?error=Please+enter+your+email');
  }

  const callback = new URL('/auth/callback', await siteUrl());
  callback.searchParams.set('next', next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback.toString(),
      // Project-level signups are also off; this makes the failure mode louder
      // for emails not already in auth.users.
      shouldCreateUser: false,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/login?sent=${encodeURIComponent(email)}`);
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get('next'));

  const callback = new URL('/auth/callback', await siteUrl());
  callback.searchParams.set('next', next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? 'Google sign-in failed')}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// ---------- User admin (0018 Phase 1) ----------

function revalidateUserAdmin() {
  revalidatePath('/admin/users');
}

function parseRolesField(formData: FormData): V1TeamRole[] | { error: string } {
  // role-set is submitted as repeated `roles` form fields (one per checked box).
  const raw = formData.getAll('roles').map((v) => String(v));
  for (const r of raw) {
    if (!V1_TEAM_ROLES.includes(r as V1TeamRole)) {
      return { error: `Role '${r}' is not selectable in v1 (admin and coach only).` };
    }
  }
  return Array.from(new Set(raw)) as V1TeamRole[];
}

export async function createUser(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const email = field(formData, 'email').toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { error: 'A valid email is required.' };
  }
  const roles = parseRolesField(formData);
  if ('error' in roles) return roles;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    return { error: error?.message ?? 'Could not create user.' };
  }

  if (roles.length > 0) {
    const result = await applyRoleSet(data.user.id, roles);
    if ('error' in result) return result;
  } else {
    // Strip any previous app_metadata.role if present (defensive).
    await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: null } });
  }

  revalidateUserAdmin();
  return { ok: true };
}

export async function deactivateUser(formData: FormData): Promise<ActionResult> {
  const adminUser = await requireAdmin();

  const userId = field(formData, 'userId');
  if (!userId) return { error: 'Invalid user id.' };
  if (userId === adminUser.id) {
    return { error: 'You cannot deactivate your own account.' };
  }

  const admin = createAdminClient();
  // ban_duration ~100y is Supabase's "soft delete" idiom — keeps history but
  // blocks sign-in. Keeping the auth.users row preserves audit columns
  // (created_by_id / updated_by_id FKs) elsewhere in the schema.
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
    app_metadata: { role: null },
  });
  if (error) return { error: error.message };

  // Archive the *relationship* (team_member_roles), not the master record
  // (contacts). The contact stays active so existing FKs — campaigns.coach_id,
  // share-link routes, "email assigned coach" workflows — keep resolving by
  // historical reference. The archived role rows are what stop the person from
  // being picked for new assignments. See docs/wiki/lifecycle.md.
  await db
    .update(teamMemberRoles)
    .set({ archivedAt: new Date() })
    .where(
      and(
        isNull(teamMemberRoles.archivedAt),
        inArray(
          teamMemberRoles.contactId,
          db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.userId, userId), isNull(contacts.archivedAt))),
        ),
      ),
    );

  revalidateUserAdmin();
  return { ok: true };
}

export async function setUserRoles(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const userId = field(formData, 'userId');
  if (!userId) return { error: 'Invalid user id.' };

  const roles = parseRolesField(formData);
  if ('error' in roles) return roles;

  const result = await applyRoleSet(userId, roles);
  if ('error' in result) return result;

  revalidateUserAdmin();
  return { ok: true };
}

async function applyRoleSet(
  userId: string,
  desired: V1TeamRole[],
): Promise<ActionResult> {
  const [linked] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), isNull(contacts.archivedAt)))
    .limit(1);

  if (!linked && desired.length > 0) {
    return {
      error:
        'This user is not linked to a contact yet. Link a contact (Phase 3) before assigning roles.',
    };
  }

  // Order: DB transaction first, then app_metadata. If the DB sync fails, the
  // function returns the error before any auth-side mutation, so the gate
  // (app_metadata.role) never drifts ahead of the relationship truth
  // (team_member_roles). If the auth update fails afterwards the DB already
  // reflects the desired state and the admin can retry — only the gate cache
  // is stale, no privilege escalation has occurred.
  if (linked) {
    const contactId = linked.id;
    try {
      await db.transaction(async (tx) => {
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
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not sync team_member_roles.';
      return { error: msg };
    }
  }

  const admin = createAdminClient();
  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role: desired.includes('admin') ? 'admin' : null },
  });
  if (metaErr) {
    // DB already committed; surface the auth-side error so the admin can retry.
    return {
      error: `Roles saved, but the auth gate did not update: ${metaErr.message}. Re-submit to retry.`,
    };
  }

  return { ok: true };
}
