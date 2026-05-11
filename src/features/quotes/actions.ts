'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, quotes } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { recordAudit } from '@/features/audit/actions';
import { parseId } from '@/features/schedule/validators';
import { markQuoteDeclined } from './lifecycle';

// 0026 Phase 2 — `quotes` data model + bare-bones Server Actions.
//
// Scope: `createQuote` stands up a draft row with zeroed inputs/totals; the
// composer (0035 Phase 3) extends this file with `setQuoteInputs`,
// `setQuoteTax`, `setQuoteDealer` setters that recompute lines + totals and
// persist them. `sendQuote` is the lifecycle-transition action — Phase 3
// wires `renderQuotePdf` + GCS storage; Phase 4 wires the email send + the
// public accept/decline route handler. For now `sendQuote` is idempotent on
// the `draft → sent` transition and emits the `quote.sent` audit row; PDF +
// email land in subsequent phases (TODOs flagged inline).
//
// `declineQuote` is the staff-side decline; the client-side decline goes
// through the public /quote/[token] route handler in Phase 4, which calls
// `markQuoteDeclined` (in ./lifecycle.ts) after token validation. The
// internal helpers live in a separate non-`'use server'` module so the
// action-gate lint rule (0031) doesn't flag them as ungated Server Actions.
//
// **Concurrency:** lifecycle transitions use the same atomic guarded UPDATE
// pattern as `cancelCampaign` — `UPDATE … WHERE id = X AND status = from
// RETURNING id`. Returns-empty means the guard missed; re-select then
// classifies the miss as row-gone / idempotent / illegal-status.

type ActionResult = { ok: true } | { error: string };
type CreateQuoteResult = { ok: true; quoteId: number } | { error: string };

// Empty `QuoteInputs` snapshot — the composer (0035 P3) writes real values
// via `setQuoteInputs`. Default audience size of 500 + 1-day event keeps the
// base-event line viable on day-one of editing.
const DEFAULT_QUOTE_INPUTS = {
  audienceSize: 500,
  eventDays: 1,
  bdcCallCount: 0,
  letterCount: 0,
  digitalCount: 0,
  recordRetrievalAmount: 0,
  travelAmount: 0,
  travelNotes: '',
  quoteNotes: '',
} as const;

function revalidateQuoteViews() {
  revalidatePath('/quotes');
  revalidatePath('/production');
}

export const createQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<CreateQuoteResult> => {
    const userId = ctx.user.id;

    const dealerId = parseId(formData, 'dealerId');
    if (dealerId == null) return { error: 'Dealer is required.' };

    // Verify the dealer exists and is unarchived. `quotes.dealer_id` has
    // `ON DELETE RESTRICT` so a stale id would surface as an opaque FK
    // violation — explicit check yields a friendlier message. The
    // `archivedAt IS NULL` clause matches `createCampaign`'s active-dealer
    // check in src/features/schedule/actions.ts so archived dealers don't
    // get new quotes through the back door.
    const dealer = await db
      .select({ id: dealers.id })
      .from(dealers)
      .where(and(eq(dealers.id, dealerId), isNull(dealers.archivedAt)))
      .limit(1);
    if (!dealer.length) return { error: 'Dealer not found or archived.' };

    const [row] = await db
      .insert(quotes)
      .values({
        dealerId,
        inputs: DEFAULT_QUOTE_INPUTS,
        createdById: userId,
        updatedById: userId,
      })
      .returning({ id: quotes.id });

    await recordAudit({
      action: 'quote.create',
      targetTable: 'quotes',
      targetId: row.id,
      payload: { dealerId },
    });

    revalidateQuoteViews();
    return { ok: true, quoteId: row.id };
  });

export const sendQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    // TODO(Phase 3): call `renderQuotePdf` + `putObject` to GCS, persist
    // `pdfStorageKey` here. TODO(Phase 4): send the React Email + PDF
    // attachment via the Resend wiring; route handler at /quote/[token]
    // serves the accept/decline links.

    // Atomic guarded transition — only flip rows currently in draft. On
    // miss, re-select to classify (gone / idempotent / illegal). Same
    // pattern as `cancelCampaign`.
    const updated = await db
      .update(quotes)
      .set({ status: 'sent', sentAt: new Date(), updatedById: userId })
      .where(and(eq(quotes.id, quoteId), eq(quotes.status, 'draft')))
      .returning({ id: quotes.id });

    if (!updated.length) {
      const [row] = await db
        .select({ id: quotes.id, status: quotes.status })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      if (!row) return { error: 'Quote not found.' };
      if (row.status === 'sent') {
        revalidateQuoteViews();
        return { ok: true }; // idempotent
      }
      return { error: `Quote cannot be sent from status '${row.status}'.` };
    }

    await recordAudit({
      action: 'quote.sent',
      targetTable: 'quotes',
      targetId: quoteId,
      payload: null,
    });

    revalidateQuoteViews();
    return { ok: true };
  });

// Staff-side decline. The client-side decline path goes through the public
// /quote/[token] route handler in Phase 4, which calls `markQuoteDeclined`
// directly after token validation (no audit-emit there because the actor is
// the client, not a staff user — Phase 4 extends `recordAudit` to accept
// `actorRole='client'`).
export const declineQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const result = await markQuoteDeclined(quoteId, userId);
    if ('error' in result) return result;

    // Skip audit emit on the idempotent already-declined path — only the
    // actual sent → declined transition is a state-change worth a forensic
    // row. (Draft quotes cannot be declined; `markQuoteDeclined` rejects
    // that.)
    if (result.transitioned) {
      await recordAudit({
        action: 'quote.declined',
        targetTable: 'quotes',
        targetId: quoteId,
        payload: { source: 'staff' },
      });
    }

    revalidateQuoteViews();
    return { ok: true };
  });
