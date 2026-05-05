// One-time orphan adoption: walks `auth.users`, finds rows with no matching
// `contacts.user_id` link, and prints them for the admin to adopt manually
// via /admin/people. With the `--auto` flag, materializes a contacts row
// per orphan using the email's local-part as a stub firstName + "(orphan)"
// as lastName — useful for bulk-importing legacy state. Idempotent.
//
// Run:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/adopt-orphan-auth-users.ts            # dry-run / list
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/adopt-orphan-auth-users.ts --auto    # auto-adopt all

import { createClient } from '@supabase/supabase-js';
import { and, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { contactIdentifiers, contacts } from '../src/lib/db/schema';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SERVICE_KEY || !DATABASE_URL) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL');
  process.exit(1);
}

const args = process.argv.slice(2);
const auto = args.includes('--auto');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function findOrphans() {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  if (data.users.length === 0) return [];

  const userIds = data.users.map((u) => u.id);
  const linked = await db
    .select({ userId: contacts.userId })
    .from(contacts)
    .where(and(inArray(contacts.userId, userIds), isNull(contacts.archivedAt)));
  const linkedSet = new Set(linked.map((l) => l.userId));

  return data.users.filter((u) => !linkedSet.has(u.id));
}

async function adopt(authUserId: string, email: string | null | undefined) {
  // Stub names from the email local-part — same idempotent pattern as the
  // /admin/people Adopt dialog when invoked from the UI. Admin can rename
  // the contact afterwards via Edit Person.
  const localPart = email?.split('@')[0]?.replace(/[._-]/g, ' ').trim() || 'Unprovisioned';
  const firstName = localPart.split(' ')[0] ?? 'Unprovisioned';
  const lastName = `(orphan ${authUserId.slice(0, 8)})`;

  // Single transaction so a unique-index conflict on the email identifier
  // (which the global active-uniqueness index enforces) rolls back the
  // contacts row too — avoids leaving a stub contact linked to the auth user
  // that future dry-runs would silently filter out as "already linked."
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({ firstName, lastName, userId: authUserId })
      .returning({ id: contacts.id });

    if (email) {
      await tx.insert(contactIdentifiers).values({
        contactId: row.id,
        kind: 'email',
        value: email.toLowerCase(),
        isPrimary: true,
        source: 'adopt-orphan-script',
      });
    }
    return row.id;
  });
}

async function main() {
  try {
    const orphans = await findOrphans();
    if (orphans.length === 0) {
      console.log('No orphan auth users.');
      return;
    }

    console.log(`Found ${orphans.length} orphan auth user(s):`);
    for (const u of orphans) {
      console.log(`  ${u.id}  ${u.email ?? '(no email)'}  last sign-in: ${u.last_sign_in_at ?? '—'}`);
    }

    if (!auto) {
      console.log('\nDry run only. Pass --auto to adopt them with stub names.');
      console.log('(Or use /admin/people in the app to adopt one by one with proper names.)');
      return;
    }

    console.log('\nAdopting…');
    let succeeded = 0;
    let failed = 0;
    for (const u of orphans) {
      try {
        const contactId = await adopt(u.id, u.email);
        console.log(`  ✓ ${u.email ?? u.id} → contacts.id=${contactId}`);
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${u.email ?? u.id}: ${msg}`);
        failed++;
      }
    }
    console.log(`Done. ${succeeded} adopted, ${failed} failed.`);
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
