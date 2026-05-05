// One-shot bootstrap: promote a user to admin.
//
// Sets `app_metadata.role = 'admin'` on the auth.users row AND inserts a
// `team_member_roles(role='admin')` row for the matching contact (creating the
// contacts row + email identifier if absent). Idempotent.
//
// Run: set -a && source .env.local && set +a && pnpm dlx tsx scripts/promote-admin.ts <email> [firstName] [lastName]

import { createClient } from '@supabase/supabase-js';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { contactIdentifiers, contacts, teamMemberRoles } from '../src/lib/db/schema';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SERVICE_KEY || !DATABASE_URL) {
  console.error(
    'Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL'
  );
  process.exit(1);
}

const [, , rawEmail, firstNameArg, lastNameArg] = process.argv;
if (!rawEmail) {
  console.error('Usage: pnpm dlx tsx scripts/promote-admin.ts <email> [firstName] [lastName]');
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function findAuthUserByEmail(): Promise<{ id: string } | null> {
  // listUsers paginates; this app has < 100 users so a single page suffices.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const match = data.users.find((u) => u.email?.toLowerCase() === email);
  return match ? { id: match.id } : null;
}

async function findContactByEmail(authUserId: string): Promise<number | null> {
  const linked = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, authUserId), isNull(contacts.archivedAt)))
    .limit(1);
  if (linked.length) return linked[0].id;

  const byEmail = await db
    .select({ contactId: contactIdentifiers.contactId })
    .from(contactIdentifiers)
    .where(
      and(
        eq(contactIdentifiers.kind, 'email'),
        eq(contactIdentifiers.value, email),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .limit(1);
  return byEmail.length ? byEmail[0].contactId : null;
}

async function ensureContact(authUserId: string): Promise<number> {
  const existing = await findContactByEmail(authUserId);
  if (existing != null) {
    await db
      .update(contacts)
      .set({ userId: authUserId })
      .where(and(eq(contacts.id, existing), isNull(contacts.userId)));
    return existing;
  }

  if (!firstNameArg || !lastNameArg) {
    throw new Error(
      `No contact found for ${email}. Pass firstName + lastName as args to create one: ` +
        `pnpm dlx tsx scripts/promote-admin.ts ${email} <firstName> <lastName>`,
    );
  }

  const [row] = await db
    .insert(contacts)
    .values({ firstName: firstNameArg, lastName: lastNameArg, userId: authUserId })
    .returning({ id: contacts.id });
  await db.insert(contactIdentifiers).values({
    contactId: row.id,
    kind: 'email',
    value: email,
    isPrimary: true,
    source: 'promote-admin',
  });
  return row.id;
}

async function ensureAdminRoleRow(contactId: number) {
  const existing = await db
    .select({ id: teamMemberRoles.id, archivedAt: teamMemberRoles.archivedAt })
    .from(teamMemberRoles)
    .where(and(eq(teamMemberRoles.contactId, contactId), eq(teamMemberRoles.role, 'admin')))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(teamMemberRoles).values({ contactId, role: 'admin' });
    return 'inserted';
  }
  if (existing[0].archivedAt != null) {
    await db
      .update(teamMemberRoles)
      .set({ archivedAt: null })
      .where(eq(teamMemberRoles.id, existing[0].id));
    return 'restored';
  }
  return 'already';
}

async function main() {
  try {
    const user = await findAuthUserByEmail();
    if (!user) {
      console.error(
        `No auth.users row for ${email}. Sign in once via the app (or invite via the Supabase dashboard) first.`,
      );
      process.exit(1);
    }

    const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { role: 'admin' },
    });
    if (metaErr) throw metaErr;
    console.log(`✓ app_metadata.role = 'admin' on ${email} (${user.id})`);

    const contactId = await ensureContact(user.id);
    const status = await ensureAdminRoleRow(contactId);
    console.log(`✓ team_member_roles(contact_id=${contactId}, role='admin'): ${status}`);
    console.log('Done.');
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
