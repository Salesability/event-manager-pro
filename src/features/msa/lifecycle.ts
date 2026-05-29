import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  auditLog,
  dealers,
  masterServiceAgreements,
  quotes,
} from '@/lib/db/schema';
import { markQuoteAcceptedViaEnvelope } from '@/features/quotes/lifecycle';

// Internal lifecycle-transition helpers for MSAs. Called by the BoldSign
// webhook route handler at `/api/boldsign/webhook` (the rare legitimate
// route handler per CLAUDE.md → "Mutations go through Server Actions" — the
// caller is an external BoldSign POST, not our UI). Webhook has no
// session/user, so these helpers also write the audit row directly with
// `actorUserId = null` (audit_log.actor_user_id is nullable for exactly this
// kind of system-driven event).
//
// Lives outside actions.ts because that file carries `'use server'` and the
// action-gate lint rule (0031) would treat every exported async as a Server
// Action requiring an auth gate — these helpers are server-only mutations
// dispatched downstream of HMAC signature verification (the webhook's
// equivalent gate), not directly callable from any client.
//
// **Concurrency:** transitions are an atomic guarded UPDATE
// (`WHERE id = X AND status = 'pending' AND provider_document_id = $1
// RETURNING id`). If the guard misses, we re-select to distinguish three
// races: row gone, already in target status (idempotent), or sitting in an
// unreachable source status (illegal). Mirrors the quotes/lifecycle.ts shape.

type TransitionResult =
  | { ok: true; transitioned: boolean; msaId: number; dealerId: number }
  | { ok: true; transitioned: false; msaId: null; dealerId: null }
  | { error: string };

function plus12MonthsFrom(now: Date): Date {
  const next = new Date(now.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

// Combined-document auto-accept (chunk 0055). When the Client signs the
// combined envelope, the bundled Quote is accepted in the same signing event.
// The Quote is linked to this MSA via `quotes.msa_id` (set at send time by
// `sendMsaEnvelope`). Mirrors the side effects of the `acceptQuote` Server
// Action — quote draft|sent→accepted + prospect dealer→active — but runs as
// the system actor (no session). Best-effort and isolated: a missing/already-
// accepted quote is a silent no-op so a replayed/edge webhook never errors the
// MSA flip. `dealerId` is the MSA's dealer, already resolved by the caller.
async function acceptBundledQuote(msaId: number, dealerId: number): Promise<void> {
  // draft|sent (0061): the bundled quote may have been emailed for review
  // before its envelope was sent, so the linked row can sit in either status
  // when the signing webhook fires.
  const [quote] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.msaId, msaId), inArray(quotes.status, ['draft', 'sent'])))
    .limit(1);
  if (!quote) return;

  const accepted = await markQuoteAcceptedViaEnvelope(quote.id);
  if ('error' in accepted || !accepted.transitioned) return;

  await db.insert(auditLog).values({
    actorUserId: null,
    actorRole: 'system',
    action: 'quote.accepted',
    targetTable: 'quotes',
    targetId: quote.id,
    payload: { via: 'msa-envelope', msaId },
  });

  // Promote a prospect dealer to active — same guarded UPDATE as acceptQuote.
  const promoted = await db
    .update(dealers)
    .set({ status: 'active' })
    .where(
      and(
        eq(dealers.id, dealerId),
        eq(dealers.status, 'prospect'),
        isNull(dealers.archivedAt),
      ),
    )
    .returning({ id: dealers.id });
  if (promoted.length) {
    await db.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'dealer.activated',
      targetTable: 'dealers',
      targetId: dealerId,
      payload: { from: 'prospect', via: 'quote.accepted' },
    });
  }
}

export async function markMsaSigned(
  providerDocumentId: string,
  signedPdfStorageKey: string,
): Promise<TransitionResult> {
  const signedAt = new Date();
  const expiresAt = plus12MonthsFrom(signedAt);

  const updated = await db
    .update(masterServiceAgreements)
    .set({
      status: 'active',
      signedAt,
      expiresAt,
      signedPdfStorageKey,
    })
    .where(
      and(
        eq(masterServiceAgreements.providerDocumentId, providerDocumentId),
        eq(masterServiceAgreements.status, 'pending'),
      ),
    )
    .returning({
      id: masterServiceAgreements.id,
      dealerId: masterServiceAgreements.dealerId,
    });

  if (updated.length) {
    const { id, dealerId } = updated[0];
    await db.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'msa.signed',
      targetTable: 'master_service_agreements',
      targetId: id,
      payload: { providerDocumentId, signedPdfStorageKey },
    });
    // Same signing event accepts the bundled Quote + promotes the dealer.
    await acceptBundledQuote(id, dealerId);
    return { ok: true, transitioned: true, msaId: id, dealerId };
  }

  const [row] = await db
    .select({
      id: masterServiceAgreements.id,
      status: masterServiceAgreements.status,
    })
    .from(masterServiceAgreements)
    .where(
      eq(masterServiceAgreements.providerDocumentId, providerDocumentId),
    )
    .limit(1);
  if (!row) return { error: 'MSA not found for the supplied document id.' };
  if (row.status === 'active') {
    // Replay path: a duplicate `signature_request_all_signed` webhook for an
    // already-active MSA. Idempotent — no audit row, no error.
    return { ok: true, transitioned: false, msaId: null, dealerId: null };
  }
  return {
    error: `MSA cannot be signed from status '${row.status}'.`,
  };
}

export async function markMsaDeclined(
  providerDocumentId: string,
): Promise<TransitionResult> {
  const updated = await db
    .update(masterServiceAgreements)
    .set({ status: 'terminated' })
    .where(
      and(
        eq(masterServiceAgreements.providerDocumentId, providerDocumentId),
        eq(masterServiceAgreements.status, 'pending'),
      ),
    )
    .returning({
      id: masterServiceAgreements.id,
      dealerId: masterServiceAgreements.dealerId,
    });

  if (updated.length) {
    const { id, dealerId } = updated[0];
    await db.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'msa.declined',
      targetTable: 'master_service_agreements',
      targetId: id,
      payload: { providerDocumentId },
    });
    return { ok: true, transitioned: true, msaId: id, dealerId };
  }

  const [row] = await db
    .select({
      id: masterServiceAgreements.id,
      status: masterServiceAgreements.status,
    })
    .from(masterServiceAgreements)
    .where(
      eq(masterServiceAgreements.providerDocumentId, providerDocumentId),
    )
    .limit(1);
  if (!row) return { error: 'MSA not found for the supplied document id.' };
  if (row.status === 'terminated') {
    return { ok: true, transitioned: false, msaId: null, dealerId: null };
  }
  return {
    error: `MSA cannot be declined from status '${row.status}'.`,
  };
}
