import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { quotes } from '@/lib/db/schema';

// Internal lifecycle-transition helpers, not Server Actions. Called by both
// the staff-side `declineQuote` Server Action (in ./actions.ts) and the
// public accept/decline route handler at /quote/[token]/route.ts that Phase
// 4 will add. The route handler has no auth.users session — the actor is the
// client clicking the email link — so these helpers don't emit `recordAudit`
// directly. The caller decides whether to audit (and with what actor role).
//
// Each helper returns `{ ok: true; transitioned: boolean }` so the caller
// can skip audit emission on the idempotent already-in-target-status path.
// Error path returns `{ error }` for missing rows or illegal source-status.
//
// Lives outside `actions.ts` because that file carries `'use server'` and
// the action-gate lint rule (0031) treats every exported async in such a
// file as a Server Action requiring an auth gate — these helpers are
// server-only mutations called downstream of a gate (capability check on
// staff side, token validation on public side), not directly callable from
// any client.
//
// **Concurrency:** transitions are an atomic guarded UPDATE
// (`WHERE id = X AND status = from RETURNING id`). If the guard misses, we
// re-select to distinguish three races: row gone, already in target status
// (idempotent), or sitting in an unreachable source status (illegal). This
// is the same pattern as `cancelCampaign` in src/features/schedule/actions.ts.

type TransitionResult =
  | { ok: true; transitioned: boolean }
  | { error: string };

async function transition(
  quoteId: number,
  from: 'sent',
  to: 'accepted' | 'declined',
  updatedById: string | null
): Promise<TransitionResult> {
  const timestampPatch = to === 'accepted'
    ? { acceptedAt: new Date() }
    : { declinedAt: new Date() };

  const updated = await db
    .update(quotes)
    .set({
      status: to,
      ...timestampPatch,
      ...(updatedById ? { updatedById } : {}),
    })
    .where(and(eq(quotes.id, quoteId), eq(quotes.status, from)))
    .returning({ id: quotes.id });

  if (updated.length) return { ok: true, transitioned: true };

  // Guard missed. Re-select to figure out why: missing row vs. idempotent
  // already-in-target vs. illegal source status.
  const [row] = await db
    .select({ id: quotes.id, status: quotes.status })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!row) return { error: 'Quote not found.' };
  if (row.status === to) return { ok: true, transitioned: false }; // idempotent
  return { error: `Quote cannot be ${to} from status '${row.status}'.` };
}

export function markQuoteAccepted(
  quoteId: number,
  updatedById: string | null = null
): Promise<TransitionResult> {
  return transition(quoteId, 'sent', 'accepted', updatedById);
}

export function markQuoteDeclined(
  quoteId: number,
  updatedById: string | null = null
): Promise<TransitionResult> {
  return transition(quoteId, 'sent', 'declined', updatedById);
}
