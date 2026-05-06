// Phase 2 of 0023-people-dealer-role: assign the new `dealer` team_member_role
// to every contacts row that (a) has a non-archived `dealer_contacts` row and
// (b) has zero non-archived `team_member_roles` rows. Closes the
// "dealer-side staff exist as roleless contacts" gap from 0023's premise.
//
// Idempotent via the `team_member_roles_contact_id_role_unique` partial
// index — re-running after a successful apply is a no-op (the new rows
// already exist; nothing matches the candidate filter).
//
// Run (dry-run by default; lists candidates without inserting):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/backfill-dealer-role.ts
//
// Apply mode (commits one row per candidate inside a single transaction):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/backfill-dealer-role.ts --apply
//
// The script also prints a "needs human triage" list: contacts with NO
// non-archived role AND NO non-archived dealer_contacts row. These are
// truly orphaned and must be either given a role, archived, or deleted
// before the Phase 5 "every contact has a role" invariant can land.

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { teamMemberRoles } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL');
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

type Candidate = {
  contactId: number;
  displayName: string;
  dealerNames: string;
};

type Orphan = {
  contactId: number;
  displayName: string;
  archivedAt: Date | null;
};

async function findCandidates(): Promise<Candidate[]> {
  // Contacts that have ≥1 non-archived dealer_contacts row AND zero
  // non-archived team_member_roles rows. We aggregate dealer names so the
  // dry-run output reads as `<contactId>  <displayName>  (Dealer A, Dealer B)`.
  const rows = await db.execute<{
    contact_id: number;
    display_name: string;
    dealer_names: string;
  }>(sql`
    SELECT
      c.id::int      AS contact_id,
      c.display_name AS display_name,
      string_agg(d.name, ', ' ORDER BY d.name) AS dealer_names
    FROM public.contacts c
    JOIN public.dealer_contacts dc
      ON dc.contact_id = c.id AND dc.archived_at IS NULL
    JOIN public.dealers d ON d.id = dc.dealer_id
    WHERE c.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.team_member_roles tmr
        WHERE tmr.contact_id = c.id AND tmr.archived_at IS NULL
      )
    GROUP BY c.id, c.display_name
    ORDER BY c.id
  `);
  return rows.map((r) => ({
    contactId: r.contact_id,
    displayName: r.display_name,
    dealerNames: r.dealer_names,
  }));
}

async function findOrphans(): Promise<Orphan[]> {
  // Contacts with NO active role AND NO active dealer link — Phase 5's "needs
  // human triage" list. We include archived contacts in the report so the
  // admin can decide whether they're truly orphaned or already retired.
  const rows = await db.execute<{
    contact_id: number;
    display_name: string;
    archived_at: Date | null;
  }>(sql`
    SELECT
      c.id::int      AS contact_id,
      c.display_name AS display_name,
      c.archived_at  AS archived_at
    FROM public.contacts c
    WHERE NOT EXISTS (
        SELECT 1 FROM public.team_member_roles tmr
        WHERE tmr.contact_id = c.id AND tmr.archived_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.dealer_contacts dc
        WHERE dc.contact_id = c.id AND dc.archived_at IS NULL
      )
    ORDER BY c.archived_at NULLS FIRST, c.id
  `);
  return rows.map((r) => ({
    contactId: r.contact_id,
    displayName: r.display_name,
    archivedAt: r.archived_at,
  }));
}

async function main() {
  try {
    const candidates = await findCandidates();
    const orphans = await findOrphans();

    console.log(`Backfill candidates (dealer-link, no team_member_roles): ${candidates.length}`);
    for (const c of candidates) {
      console.log(`  ${String(c.contactId).padStart(5)}  ${c.displayName}  (${c.dealerNames})`);
    }

    if (orphans.length > 0) {
      console.log('');
      console.log(`"Needs human triage" — roleless AND no dealer link: ${orphans.length}`);
      for (const o of orphans) {
        const status = o.archivedAt ? `archived ${o.archivedAt.toISOString().slice(0, 10)}` : 'ACTIVE';
        console.log(`  ${String(o.contactId).padStart(5)}  ${o.displayName}  [${status}]`);
      }
    } else {
      console.log('');
      console.log('No truly-orphan contacts (everyone has a role or a dealer link).');
    }

    if (!apply) {
      console.log('');
      console.log(candidates.length === 0
        ? 'Dry-run: no work to do.'
        : `Dry-run: ${candidates.length} insert(s) pending. Re-run with --apply to commit.`);
      return;
    }

    if (candidates.length === 0) {
      console.log('');
      console.log('Nothing to apply.');
      return;
    }

    // Single transaction so a partial failure rolls back. Each row uses the
    // contact_id_role partial unique index for idempotency — a re-run after
    // any apply is a no-op because the candidate filter excludes contacts
    // that now have a `dealer` role.
    await db.transaction(async (tx) => {
      for (const c of candidates) {
        await tx.insert(teamMemberRoles).values({
          contactId: c.contactId,
          role: 'dealer',
          // No createdById/updatedById — system-driven backfill, no
          // attributable actor. The columns are nullable; the `actors`
          // mixin defaults to null when omitted.
        });
      }
    });

    console.log('');
    console.log(`Applied: ${candidates.length} row(s) inserted.`);
  } finally {
    await pg.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
