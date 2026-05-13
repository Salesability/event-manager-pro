import 'server-only';
import { db } from '@/lib/db';
import { auditLog } from '@/lib/db/schema';
import { getUser } from '@/lib/supabase/session';

// Single insertion point for forensic audit rows. Called from inside each
// sensitive Server Action after the mutation succeeds. **Best-effort write:**
// the helper catches and logs any insert failure rather than rejecting the
// caller, because in practice our sensitive actions span DB + Supabase auth
// (archivePerson, updatePerson) so wrapping the audit in the mutation
// transaction wouldn't actually keep them atomic. A failed audit shows up in
// server logs (`audit insert failed`) and creates a forensic gap, but doesn't
// reverse a mutation that's already committed. This deviates from plan
// Decision #3's "same transaction" framing — see Phase 4 eval-2026-05-06 for
// the trade-off rationale.
//
// `actorRole` is denormalised at write time so a future role change on the
// actor doesn't rewrite history. Reads `app_metadata.role` (admin) when set,
// else null. The `actor_user_id` FK is `ON DELETE SET NULL` so removing an
// auth user keeps the audit history with a tombstoned actor.
//
// Throws if no user is signed in — that's a "you wired it wrong" assertion
// since every caller is downstream of a capability gate (`assertCan` /
// `capabilityClient`) that already redirected an unauthed request.

export type AuditActionId =
  | 'user.role_changed'
  | 'user.deactivated'
  | 'dealer.archived'
  | 'dealer.activated'
  | 'campaign.cancelled'
  | 'quote.create'
  | 'quote.sent'
  | 'quote.edited'
  | 'quote.accepted'
  | 'quote.declined'
  | 'msa.created'
  | 'msa.sent'
  | 'msa.signed'
  | 'msa.declined';

export type RecordAuditInput = {
  action: AuditActionId;
  targetTable: string;
  targetId: number | null;
  payload?: Record<string, unknown> | null;
};

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('recordAudit called without a signed-in user');
  }
  const actorRole =
    (user.app_metadata?.role as string | undefined | null) ?? null;
  try {
    await db.insert(auditLog).values({
      actorUserId: user.id,
      actorRole,
      action: input.action,
      targetTable: input.targetTable,
      targetId: input.targetId,
      payload: input.payload ?? null,
    });
  } catch (err) {
    console.error('audit insert failed', {
      action: input.action,
      targetTable: input.targetTable,
      targetId: input.targetId,
      actorUserId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
