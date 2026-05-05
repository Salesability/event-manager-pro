import 'server-only';
import { and, asc, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, teamMemberRoles } from '@/lib/db/schema';
import { createAdminClient } from '@/lib/supabase/admin';

export type AdminUserRow = {
  id: string;
  email: string | null;
  providers: string[];
  lastSignInAt: string | null;
  bannedUntil: string | null;
  appMetadataRole: string | null;
  contactId: number | null;
  displayName: string | null;
  roles: ('admin' | 'staff' | 'coach' | 'viewer')[];
};

export type UnlinkedContactOption = {
  id: number;
  displayName: string;
};

export async function loadUnlinkedContacts(): Promise<UnlinkedContactOption[]> {
  const rows = await db
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
    })
    .from(contacts)
    .where(and(isNull(contacts.userId), isNull(contacts.archivedAt)))
    .orderBy(asc(contacts.displayName));
  return rows;
}

export async function loadAdminUsers(): Promise<AdminUserRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;

  const userIds = data.users.map((u) => u.id);
  if (userIds.length === 0) return [];

  const linked = await db
    .select({
      userId: contacts.userId,
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(contacts)
    .where(and(inArray(contacts.userId, userIds), isNull(contacts.archivedAt)));

  const byUser = new Map(linked.map((l) => [l.userId!, l]));
  const contactIds = linked.map((l) => l.contactId);

  const roles = contactIds.length
    ? await db
        .select({
          contactId: teamMemberRoles.contactId,
          role: teamMemberRoles.role,
        })
        .from(teamMemberRoles)
        .where(
          and(inArray(teamMemberRoles.contactId, contactIds), isNull(teamMemberRoles.archivedAt)),
        )
    : [];

  const rolesByContact = new Map<number, AdminUserRow['roles']>();
  for (const r of roles) {
    const arr = rolesByContact.get(r.contactId) ?? [];
    arr.push(r.role);
    rolesByContact.set(r.contactId, arr);
  }

  return data.users.map<AdminUserRow>((u) => {
    const link = byUser.get(u.id);
    const banned = (u as { banned_until?: string | null }).banned_until ?? null;
    const providers = (u.identities ?? []).map((i) => i.provider).filter(Boolean) as string[];
    return {
      id: u.id,
      email: u.email ?? null,
      providers: providers.length ? Array.from(new Set(providers)) : ['email'],
      lastSignInAt: u.last_sign_in_at ?? null,
      bannedUntil: banned,
      appMetadataRole: typeof u.app_metadata?.role === 'string' ? u.app_metadata.role : null,
      contactId: link?.contactId ?? null,
      displayName: link ? `${link.firstName} ${link.lastName}`.trim() : null,
      roles: link ? rolesByContact.get(link.contactId) ?? [] : [],
    };
  }).sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
}
