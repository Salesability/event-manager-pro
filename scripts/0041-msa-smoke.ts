// Throwaway fixture for the 0041 chunk-end browser smoke: seeds a `pending`
// MSA + a fully-signed `active` MSA against dealer #1 so the
// /dealerships/[id] panel can be eyeballed in both states without going
// through the (not-yet-credentialed) Dropbox Sign envelope flow.
//
// The signed-MSA fixture uses a dummy `signed_pdf_storage_key` — the panel
// renders the download link unconditionally for `active` rows, but the
// resulting V4 signed URL will 404 if the GCS object doesn't exist. That's
// fine for the smoke check; we're verifying the panel renders, not that
// Dropbox Sign produced a real signed artifact.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0041-msa-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0041-msa-smoke.ts cleanup
//
// `cleanup` is idempotent — runs the two DELETE statements + the audit-log
// purge regardless of whether the rows exist. Audit purges are explicit
// because the lifecycle helpers in `src/features/msa/lifecycle.ts` write
// audit rows on the signed flip, and reusing the same dealer across smoke
// runs would otherwise leave stale audit trails.

import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { auditLog, masterServiceAgreements } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL');
  process.exit(1);
}

const DEALER_ID = 1;
const FIXTURE_MARKER = '0041-msa-smoke';

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0041-msa-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

const PENDING_DROPBOX_ID = `${FIXTURE_MARKER}-pending`;
const SIGNED_DROPBOX_ID = `${FIXTURE_MARKER}-signed`;

async function insert() {
  console.log(`Inserting smoke fixtures for dealer #${DEALER_ID}...`);
  const now = new Date();
  const signedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday
  const expiresAt = new Date(signedAt.getTime());
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

  // Pending row: as if `sendMsaEnvelope` posted the envelope but the signer
  // hasn't acted yet. `providerDocumentId` is set so the panel renders the
  // "awaiting signer" caption.
  const [pending] = await db
    .insert(masterServiceAgreements)
    .values({
      dealerId: DEALER_ID,
      status: 'pending',
      providerDocumentId: PENDING_DROPBOX_ID,
      templateVersion: `${FIXTURE_MARKER}-v1`,
    })
    .returning({ id: masterServiceAgreements.id });
  console.log(`  pending MSA inserted: id=${pending.id}`);

  // Signed (active) row: as if `markMsaSigned` flipped the row after the
  // webhook fired. Uses a dummy GCS key — the panel renders the Download
  // button link unconditionally; clicking 404s without harm.
  const [active] = await db
    .insert(masterServiceAgreements)
    .values({
      dealerId: DEALER_ID,
      status: 'active',
      providerDocumentId: SIGNED_DROPBOX_ID,
      signedAt,
      expiresAt,
      signedPdfStorageKey: `msa/${FIXTURE_MARKER}/signed.pdf`,
      templateVersion: `${FIXTURE_MARKER}-v1`,
    })
    .returning({ id: masterServiceAgreements.id });
  console.log(`  active MSA inserted: id=${active.id}`);

  console.log();
  console.log(
    'Inserted. Visit /dealerships/1 to verify the panel renders the active row',
  );
  console.log(
    '(loadActiveOrPendingMsa() prefers active over pending — the pending row',
  );
  console.log(
    'demonstrates the cleanup discipline, not the live UI render).',
  );
}

async function cleanup() {
  console.log(`Cleaning up smoke fixtures for dealer #${DEALER_ID}...`);
  const rows = await db
    .select({
      id: masterServiceAgreements.id,
      providerDocumentId: masterServiceAgreements.providerDocumentId,
    })
    .from(masterServiceAgreements)
    .where(
      and(
        eq(masterServiceAgreements.dealerId, DEALER_ID),
        sql`${masterServiceAgreements.providerDocumentId} IN (${PENDING_DROPBOX_ID}, ${SIGNED_DROPBOX_ID})`,
      ),
    );
  console.log(`  Found ${rows.length} fixture row(s):`, rows);

  for (const row of rows) {
    // The audit-log writer in lifecycle.ts emits `msa.signed`/`msa.declined`
    // with target_id = msa.id; purge by id to keep the audit chain clean
    // between smoke runs.
    await db
      .delete(auditLog)
      .where(
        sql`${auditLog.targetTable} = 'master_service_agreements' AND ${auditLog.targetId} = ${row.id}`,
      );
    await db
      .delete(masterServiceAgreements)
      .where(eq(masterServiceAgreements.id, row.id));
    console.log(`  Deleted MSA id=${row.id} + matching audit rows.`);
  }
  console.log('Done.');
}

(async () => {
  try {
    if (arg === 'insert') await insert();
    else await cleanup();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
