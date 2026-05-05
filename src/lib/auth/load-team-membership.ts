import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, teamMemberRoles } from '@/lib/db/schema';
import { getUser } from '@/lib/supabase/session';

export type TeamMemberRole = 'admin' | 'staff' | 'coach' | 'viewer';

export type CurrentMembership = {
  contactId: number;
  roles: TeamMemberRole[];
  coachContactId: number | null;
};

// Resolve the signed-in user's link into our domain: their contacts row + any
// active team_member_roles. Returns null if the user is not signed in or has
// no contacts row yet (e.g. an auth account that hasn't been linked through
// `/admin/users` or the auto-link trigger). `coachContactId` is set IFF the
// roles include 'coach', and is the contact id used by the calendar's
// auto-filter — it always equals `contactId` when set, but is exposed
// separately so callers don't have to re-derive intent from the role list.
export async function loadCurrentMembership(): Promise<CurrentMembership | null> {
  const user = await getUser();
  if (!user) return null;

  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, user.id), isNull(contacts.archivedAt)))
    .limit(1);
  if (!contact) return null;

  const roleRows = await db
    .select({ role: teamMemberRoles.role })
    .from(teamMemberRoles)
    .where(
      and(eq(teamMemberRoles.contactId, contact.id), isNull(teamMemberRoles.archivedAt)),
    );

  const roles = roleRows.map((r) => r.role) as TeamMemberRole[];
  const coachContactId = roles.includes('coach') ? contact.id : null;

  return { contactId: contact.id, roles, coachContactId };
}
