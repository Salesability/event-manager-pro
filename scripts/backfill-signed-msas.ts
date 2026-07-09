// One-off remediation (2026-07-08). BoldSign completion webhooks were never
// delivered to prod (no POSTs after 2026-06-23), so MSAs the dealers actually
// signed stayed `pending` in the app — never activated, signed PDF never
// archived. For each `pending` MSA whose BoldSign document status is
// `Completed`, this reproduces the webhook's handleSigned path EXACTLY, reusing
// the same functions the webhook route uses:
//   getSignedFileBytes(docId) -> putObject(GCS) -> markMsaSigned(docId, key)
// so the DB flip (status=active, signed_at, expires_at, signed_pdf_storage_key)
// + the `msa.signed` audit row are written identically to a real webhook.
//
// Dry-run by default (BoldSign reads + DB reads only — no auth beyond the API
// key + prod DB). Pass --write to apply (needs GCS write auth). Idempotent:
// only `pending` rows are considered and markMsaSigned is guarded on `pending`,
// so a re-run skips already-activated rows.
//
// Run (dry-run):
//   KEY=$(gcloud secrets versions access latest --secret=boldsign-api-key --project=eventpro-498313)
//   BOLDSIGN_API_KEY="$KEY" BOLDSIGN_API_BASE_URL=https://api-ca.boldsign.com \
//     GCS_BUCKET=eventpro-498313-pdfs GCS_PROJECT_ID=eventpro-498313 \
//     NODE_OPTIONS="--require $(pwd)/scratchpad/stub-cjs.cjs" \
//     ./scripts/with-prod-db.sh node_modules/.bin/tsx scripts/backfill-signed-msas.ts
//   (append --write to apply.)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { masterServiceAgreements, dealers } from '../src/lib/db/schema';
import { getSignedFileBytes } from '../src/lib/boldsign/client';
import { markMsaSigned } from '../src/features/msa/lifecycle';

// GCS upload via the gcloud CLI (uses the interactive-login credentials this
// script already runs under) rather than the app's putObject → Storage SDK,
// which would need ADC set up locally. Same resulting object + content-type.
function uploadPdf(bucket: string, key: string, body: Buffer): void {
  const dir = mkdtempSync(join(tmpdir(), 'msa-backfill-'));
  try {
    const tmp = join(dir, 'signed.pdf');
    writeFileSync(tmp, body);
    execFileSync(
      'gcloud',
      ['storage', 'cp', tmp, `gs://${bucket}/${key}`, '--content-type=application/pdf'],
      { stdio: 'pipe' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WRITE = process.argv.includes('--write');
const BASE = process.env.BOLDSIGN_API_BASE_URL;
const KEY = process.env.BOLDSIGN_API_KEY;
const BUCKET = process.env.GCS_BUCKET;

async function boldsignStatus(docId: string): Promise<string> {
  const res = await fetch(
    `${BASE}/v1/document/properties?documentId=${encodeURIComponent(docId)}`,
    { headers: { 'X-API-KEY': KEY ?? '' } },
  );
  if (!res.ok) return `HTTP_${res.status}`;
  const j = (await res.json()) as { status?: unknown };
  return typeof j?.status === 'string' ? j.status : 'UNKNOWN';
}

async function main() {
  if (!BASE || !KEY) {
    console.error('Missing BOLDSIGN_API_BASE_URL / BOLDSIGN_API_KEY in env.');
    process.exit(1);
  }
  if (WRITE && !BUCKET) {
    console.error('Missing GCS_BUCKET (required for --write).');
    process.exit(1);
  }

  const rows = await db
    .select({
      id: masterServiceAgreements.id,
      dealerId: masterServiceAgreements.dealerId,
      dealer: dealers.name,
      docId: masterServiceAgreements.providerDocumentId,
    })
    .from(masterServiceAgreements)
    .leftJoin(dealers, eq(dealers.id, masterServiceAgreements.dealerId))
    .where(eq(masterServiceAgreements.status, 'pending'));

  console.log(`Pending MSAs: ${rows.length}. Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}\n`);

  let wouldActivate = 0;
  let activated = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const label = `MSA #${r.id} (${r.dealer ?? `dealer ${r.dealerId}`})`;
    if (!r.docId) {
      console.log(`  ${label}: no providerDocumentId — skip`);
      skipped++;
      continue;
    }
    const st = await boldsignStatus(r.docId);
    if (st !== 'Completed') {
      console.log(`  ${label}: BoldSign=${st} — skip (not signed)`);
      skipped++;
      continue;
    }
    if (!WRITE) {
      console.log(`  ${label}: BoldSign=Completed → WOULD activate + archive signed PDF`);
      wouldActivate++;
      continue;
    }
    const signed = await getSignedFileBytes(r.docId);
    if ('error' in signed) {
      console.log(`  ${label}: signed-PDF download FAILED — ${signed.error}`);
      failed++;
      continue;
    }
    const key = `msa/${r.id}/signed.pdf`;
    try {
      uploadPdf(BUCKET as string, key, signed.body);
    } catch (e) {
      console.log(
        `  ${label}: GCS upload FAILED — ${e instanceof Error ? e.message : String(e)}`,
      );
      failed++;
      continue;
    }
    const flip = await markMsaSigned(r.docId, key);
    if ('error' in flip) {
      console.log(`  ${label}: markMsaSigned FAILED — ${flip.error}`);
      failed++;
      continue;
    }
    console.log(`  ${label}: ✓ activated → gs://${BUCKET}/${key}`);
    activated++;
  }

  console.log(
    `\nSummary — ${
      WRITE ? `activated=${activated}, failed=${failed}` : `wouldActivate=${wouldActivate}`
    }, skipped=${skipped}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
