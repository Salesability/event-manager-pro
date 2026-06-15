// Throwaway helper for local MSA-lifecycle testing. As of 0082 the main use is
// `activate <msa-id>` — flip a pending MSA to `active` so the dealer's quotes
// can be accepted (the accept gate requires an active MSA), without running the
// real BoldSign send + webhook round-trip. (The old MSA-pending in-flight
// re-send gate this script also unblocked was removed in 0082.)
//
// Three subcommands, increasing in invasiveness:
//   list                 — show all `pending` MSAs (read-only, safe)
//   unpost <msa-id>      — set provider_document_id = NULL (MSA stays `pending`)
//   activate <msa-id>    — flip status to `active`, signed_at = now(),
//                          expires_at = now() + 12 months (mimics a signed
//                          MSA; mutates lifecycle state)
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/flip-msa-status.ts list
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/flip-msa-status.ts unpost <msa-id>
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/flip-msa-status.ts activate <msa-id>
//
// CAUTION: this mutates the MSA row your `DATABASE_URL` points at. Verify the
// env target is your local/dev DB before running `unpost` or `activate`.

import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { auditLog, masterServiceAgreements } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL — run with `set -a && source .env.local && set +a` first');
  process.exit(1);
}

const cmd = process.argv[2];
const idArg = process.argv[3];
if (cmd !== 'list' && cmd !== 'unpost' && cmd !== 'activate' && cmd !== 'delete') {
  console.error('Usage: tsx scripts/flip-msa-status.ts <list|unpost|activate|delete> [msa-id]');
  process.exit(1);
}
if ((cmd === 'unpost' || cmd === 'activate' || cmd === 'delete') && !idArg) {
  console.error(`Usage: tsx scripts/flip-msa-status.ts ${cmd} <msa-id>`);
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function list() {
  const rows = await db
    .select({
      id: masterServiceAgreements.id,
      dealerId: masterServiceAgreements.dealerId,
      status: masterServiceAgreements.status,
      providerDocumentId: masterServiceAgreements.providerDocumentId,
      signedAt: masterServiceAgreements.signedAt,
      expiresAt: masterServiceAgreements.expiresAt,
      createdAt: masterServiceAgreements.createdAt,
    })
    .from(masterServiceAgreements)
    .where(eq(masterServiceAgreements.status, 'pending'));

  if (rows.length === 0) {
    console.log('No pending MSAs.');
    return;
  }
  console.log(`Found ${rows.length} pending MSA(s):`);
  for (const r of rows) {
    const blocks = r.providerDocumentId != null ? ' [BLOCKS RE-SEND]' : '';
    console.log(
      `  msa #${r.id}  dealer #${r.dealerId}  provider_document_id=${r.providerDocumentId ?? 'NULL'}  created=${r.createdAt?.toISOString()}${blocks}`,
    );
  }
}

async function unpost(id: number) {
  const [updated] = await db
    .update(masterServiceAgreements)
    .set({ providerDocumentId: null, updatedAt: new Date() })
    .where(eq(masterServiceAgreements.id, id))
    .returning({
      id: masterServiceAgreements.id,
      status: masterServiceAgreements.status,
      providerDocumentId: masterServiceAgreements.providerDocumentId,
    });
  if (!updated) {
    console.error(`No MSA with id=${id} — nothing changed.`);
    process.exit(1);
  }
  console.log(`MSA #${updated.id}: provider_document_id → NULL, status remains ${updated.status}. Re-send gate now passes.`);
}

async function activate(id: number) {
  const now = new Date();
  const expires = new Date(now);
  expires.setFullYear(expires.getFullYear() + 1);
  const [updated] = await db
    .update(masterServiceAgreements)
    .set({
      status: 'active',
      signedAt: now,
      expiresAt: expires,
      updatedAt: now,
    })
    .where(eq(masterServiceAgreements.id, id))
    .returning({
      id: masterServiceAgreements.id,
      status: masterServiceAgreements.status,
      signedAt: masterServiceAgreements.signedAt,
      expiresAt: masterServiceAgreements.expiresAt,
    });
  if (!updated) {
    console.error(`No MSA with id=${id} — nothing changed.`);
    process.exit(1);
  }
  console.log(
    `MSA #${updated.id} → active, signed_at=${updated.signedAt?.toISOString()}, expires_at=${updated.expiresAt?.toISOString()}.`,
  );
  console.log('Note: this mutation does NOT emit a msa.signed audit row. If you need the audit trail intact, run sendMsaEnvelope + the webhook flow instead.');
}

async function hardDelete(id: number) {
  // 0082: quotes no longer reference the MSA (the `quotes.msa_id` FK was
  // dropped), so there's no quote-reference pre-flight to run anymore.

  // Count audit rows that will be purged alongside (matches scripts/0041-msa-smoke.ts:115-127).
  const auditCount = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.targetTable, 'master_service_agreements'),
        eq(auditLog.targetId, id),
      ),
    );

  // Confirm the MSA exists before mutating.
  const [existing] = await db
    .select({
      id: masterServiceAgreements.id,
      dealerId: masterServiceAgreements.dealerId,
      status: masterServiceAgreements.status,
      providerDocumentId: masterServiceAgreements.providerDocumentId,
    })
    .from(masterServiceAgreements)
    .where(eq(masterServiceAgreements.id, id));
  if (!existing) {
    console.error(`No MSA with id=${id} — nothing changed.`);
    process.exit(1);
  }

  console.log(`Pre-flight for MSA #${id}:`);
  console.log(`  dealer #${existing.dealerId}  status=${existing.status}  provider_document_id=${existing.providerDocumentId ?? 'NULL'}`);
  console.log(`  ${auditCount.length} audit_log row(s) will be purged`);
  console.log();

  // Single transaction: audit rows first, then the MSA row.
  await db.transaction(async (tx) => {
    if (auditCount.length > 0) {
      await tx
        .delete(auditLog)
        .where(
          and(
            eq(auditLog.targetTable, 'master_service_agreements'),
            eq(auditLog.targetId, id),
          ),
        );
    }
    await tx
      .delete(masterServiceAgreements)
      .where(eq(masterServiceAgreements.id, id));
  });

  console.log(`Deleted MSA #${id} + ${auditCount.length} audit row(s). Dealer page should now show "No MSA on file yet" + the Create MSA button.`);
}

async function main() {
  try {
    if (cmd === 'list') await list();
    if (cmd === 'unpost') await unpost(Number(idArg));
    if (cmd === 'activate') await activate(Number(idArg));
    if (cmd === 'delete') await hardDelete(Number(idArg));
  } finally {
    await pg.end({ timeout: 5 });
  }
}

void main();

// `void sql` keeps the import live across linter passes — drizzle imports it
// transitively but eslint's import-no-unused doesn't always trace through.
void sql;
