import 'server-only';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contactIdentifiers,
  contacts,
  dealerContacts,
  dealers,
  teamMemberRoles,
} from '@/lib/db/schema';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TeamMemberRole } from '@/lib/auth/load-team-membership';

export type DealerContactRole = 'customer' | 'staff' | 'prospect';

export type DealerLink = {
  dealerId: number;
  dealerName: string;
  role: DealerContactRole;
};

export type AdminPersonAuth = {
  userId: string;
  email: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  providers: string[];
  appMetadataRole: string | null;
};

export type AdminPersonRow = {
  contactId: number;
  displayName: string;
  email: string | null;
  phone: string | null;
  hasAppAccess: boolean;
  authUser: AdminPersonAuth | null;
  roles: TeamMemberRole[];
  dealerLinks: DealerLink[];
};

// Spine: every active contacts row, optionally joined to its auth user, with
// role chips and dealer-side relationships flattened in. Mirrors the inverted
// shape of `src/features/auth/queries.ts:36` (loadAdminUsers) — that one had
// auth.users as the spine and joined contacts in. Here contacts are first-
// class and the auth user is a facet, matching the People page's UX intent
// (data-model.md:23-29).
export async function loadAdminPeople(): Promise<AdminPersonRow[]> {
  const personRows = await db
    .select({
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      displayName: contacts.displayName,
      userId: contacts.userId,
    })
    .from(contacts)
    .where(isNull(contacts.archivedAt))
    .orderBy(asc(contacts.displayName));

  if (personRows.length === 0) return [];

  const contactIds = personRows.map((p) => p.contactId);
  const linkedUserIds = personRows
    .map((p) => p.userId)
    .filter((id): id is string => id != null);

  // Roles for every visible contact, in one read.
  const roleRows = contactIds.length
    ? await db
        .select({
          contactId: teamMemberRoles.contactId,
          role: teamMemberRoles.role,
        })
        .from(teamMemberRoles)
        .where(
          and(
            inArray(teamMemberRoles.contactId, contactIds),
            isNull(teamMemberRoles.archivedAt),
          ),
        )
    : [];

  const rolesByContact = new Map<number, TeamMemberRole[]>();
  for (const r of roleRows) {
    const arr = rolesByContact.get(r.contactId) ?? [];
    arr.push(r.role);
    rolesByContact.set(r.contactId, arr);
  }

  // Dealer-side relationships, joined to dealer names so the row can render
  // a `<dealer name> (role)` chip without a second round-trip in the client.
  const dealerLinkRows = contactIds.length
    ? await db
        .select({
          contactId: dealerContacts.contactId,
          dealerId: dealerContacts.dealerId,
          dealerName: dealers.name,
          role: dealerContacts.role,
        })
        .from(dealerContacts)
        .innerJoin(dealers, eq(dealers.id, dealerContacts.dealerId))
        .where(
          and(
            inArray(dealerContacts.contactId, contactIds),
            isNull(dealerContacts.archivedAt),
            isNull(dealers.archivedAt),
          ),
        )
        .orderBy(asc(dealerContacts.dealerId))
    : [];

  const dealerLinksByContact = new Map<number, DealerLink[]>();
  for (const link of dealerLinkRows) {
    const arr = dealerLinksByContact.get(link.contactId) ?? [];
    arr.push({
      dealerId: link.dealerId,
      dealerName: link.dealerName,
      role: link.role,
    });
    dealerLinksByContact.set(link.contactId, arr);
  }

  // Primary email/phone identifier per contact (one row per kind, per contact,
  // courtesy of the `contact_identifiers_contact_kind_primary_unique` index).
  const identifierRows = contactIds.length
    ? await db
        .select({
          contactId: contactIdentifiers.contactId,
          kind: contactIdentifiers.kind,
          value: contactIdentifiers.value,
        })
        .from(contactIdentifiers)
        .where(
          and(
            inArray(contactIdentifiers.contactId, contactIds),
            isNull(contactIdentifiers.archivedAt),
            eq(contactIdentifiers.isPrimary, true),
          ),
        )
    : [];

  const emailByContact = new Map<number, string>();
  const phoneByContact = new Map<number, string>();
  for (const id of identifierRows) {
    if (id.kind === 'email') emailByContact.set(id.contactId, id.value);
    else if (id.kind === 'phone') phoneByContact.set(id.contactId, id.value);
  }

  // Auth-side facet. Single admin.listUsers call; we pluck the rows that
  // match a linked user_id. Keep `auth.admin.listUsers()` page=1/perPage=1000
  // — same scale assumption as loadAdminUsers (`auth/queries.ts:21`).
  const authByUser = new Map<string, AdminPersonAuth>();
  if (linkedUserIds.length > 0) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    const linked = new Set(linkedUserIds);
    for (const u of data.users) {
      if (!linked.has(u.id)) continue;
      const banned = (u as { banned_until?: string | null }).banned_until ?? null;
      const providers = (u.identities ?? [])
        .map((i) => i.provider)
        .filter((p): p is string => Boolean(p));
      authByUser.set(u.id, {
        userId: u.id,
        email: u.email ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        bannedUntil: banned,
        providers: providers.length ? Array.from(new Set(providers)) : ['email'],
        appMetadataRole:
          typeof u.app_metadata?.role === 'string' ? u.app_metadata.role : null,
      });
    }
  }

  return personRows.map<AdminPersonRow>((p) => {
    const authUser = p.userId ? authByUser.get(p.userId) ?? null : null;
    return {
      contactId: p.contactId,
      displayName: p.displayName,
      email: emailByContact.get(p.contactId) ?? authUser?.email ?? null,
      phone: phoneByContact.get(p.contactId) ?? null,
      hasAppAccess: authUser != null,
      authUser,
      roles: rolesByContact.get(p.contactId) ?? [],
      dealerLinks: dealerLinksByContact.get(p.contactId) ?? [],
    };
  });
}
