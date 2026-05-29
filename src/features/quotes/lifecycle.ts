import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { quotes } from '@/lib/db/schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function expiredErrorMessage(sentAt: Date, quoteValidDays: number): string {
  const sentDate = sentAt.toISOString().slice(0, 10);
  return `This Quote has expired (valid for ${quoteValidDays} days from send date — sent ${sentDate}). Re-issue a new Quote with current pricing.`;
}

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

export async function markQuoteAccepted(
  quoteId: number,
  updatedById: string | null = null
): Promise<TransitionResult> {
  // Two-layer expiry guard. (1) JS pre-load produces the friendly
  // "expired on YYYY-MM-DD" message when we can see the row is stale up
  // front. (2) The atomic UPDATE below also carries a Postgres-time
  // predicate so even under clock skew or a TOCTOU race between the
  // pre-load and the UPDATE the row can't flip to accepted past its
  // deadline. The reselect path distinguishes "missed because not sent"
  // from "missed because expired between load and UPDATE".
  //
  // Custom UPDATE/reselect rather than reusing transition() because the
  // time predicate only applies to accept — a declined-but-expired quote
  // should still be declinable.
  const [row] = await db
    .select({
      status: quotes.status,
      sentAt: quotes.sentAt,
      quoteValidDays: quotes.quoteValidDays,
    })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (row && row.status === 'sent' && row.sentAt) {
    const expiresAt = row.sentAt.getTime() + row.quoteValidDays * MS_PER_DAY;
    if (expiresAt < Date.now()) {
      return { error: expiredErrorMessage(row.sentAt, row.quoteValidDays) };
    }
  }

  const updated = await db
    .update(quotes)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
      ...(updatedById ? { updatedById } : {}),
    })
    .where(
      and(
        eq(quotes.id, quoteId),
        eq(quotes.status, 'sent'),
        sql`${quotes.sentAt} + (${quotes.quoteValidDays} * interval '1 day') >= now()`,
      ),
    )
    .returning({ id: quotes.id });
  if (updated.length) return { ok: true, transitioned: true };

  const [postRow] = await db
    .select({
      status: quotes.status,
      sentAt: quotes.sentAt,
      quoteValidDays: quotes.quoteValidDays,
    })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!postRow) return { error: 'Quote not found.' };
  if (postRow.status === 'accepted') return { ok: true, transitioned: false };
  if (postRow.status === 'sent' && postRow.sentAt) {
    const expiresAt =
      postRow.sentAt.getTime() + postRow.quoteValidDays * MS_PER_DAY;
    if (expiresAt < Date.now()) {
      return { error: expiredErrorMessage(postRow.sentAt, postRow.quoteValidDays) };
    }
  }
  return { error: `Quote cannot be accepted from status '${postRow.status}'.` };
}

export function markQuoteDeclined(
  quoteId: number,
  updatedById: string | null = null
): Promise<TransitionResult> {
  return transition(quoteId, 'sent', 'declined', updatedById);
}

// Accept a quote that was delivered for signature INSIDE a combined MSA
// envelope (chunk 0055), as opposed to the standalone quote-send flow.
// Difference from markQuoteAccepted: no `sentAt`/validity-window expiry check.
// As of 0061 the bundled quote may be draft OR sent — a coach can email it for
// review (→ sent) and then send the same quote for signature — so this accepts
// from either source status. Signing the combined BoldSign document is a
// definitive accept that supersedes any email "valid until" window, so the
// expiry guard markQuoteAccepted applies is deliberately omitted here.
// Guarded UPDATE draft|sent→accepted; idempotent if already accepted; errors on
// any other source status. Called by the MSA signed-webhook path
// (msa/lifecycle.ts) with `updatedById = null` (system actor — no session).
export async function markQuoteAcceptedViaEnvelope(
  quoteId: number,
  updatedById: string | null = null
): Promise<TransitionResult> {
  const updated = await db
    .update(quotes)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
      ...(updatedById ? { updatedById } : {}),
    })
    .where(and(eq(quotes.id, quoteId), inArray(quotes.status, ['draft', 'sent'])))
    .returning({ id: quotes.id });
  if (updated.length) return { ok: true, transitioned: true };

  const [row] = await db
    .select({ status: quotes.status })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!row) return { error: 'Quote not found.' };
  if (row.status === 'accepted') return { ok: true, transitioned: false };
  return { error: `Quote cannot be accepted from status '${row.status}'.` };
}
