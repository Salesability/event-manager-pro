'use server';

import { and, eq, gte, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { recordAudit } from '@/features/audit/actions';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { db } from '@/lib/db';
import { campaigns, smsMessages, smsOptOuts, smsRecipients, smsSends, smsThreads } from '@/lib/db/schema';
import { draftSmsReply } from '@/lib/ai/draft-sms-reply';
import { sendThreadReply } from '@/lib/sms/conversations';
import { loadInboxUnreadCount, loadThreadDraftContext } from './conversations/queries';
import { computeIdentityHmac } from '@/lib/sms/identity';
import { sendSms } from '@/lib/sms/send';
import { renderSmsBody } from '@/lib/sms/template';
import { normalizePhoneE164, parseRecipientsCsv } from './import-csv';
import {
  evaluateCampaignRecipients,
  loadSmsCampaignContext,
  type EvaluatedRecipient,
  type RecipientEvaluation,
} from './queries';

type ActionResult = { ok: true } | { error: string };

export type ImportRecipientsResult =
  | { ok: true; imported: number; duplicatesDropped: number }
  | { error: string; rowErrors?: string[] };

export type LaunchSmsResult =
  | {
      ok: true;
      sendId: number;
      accepted: number;
      failed: number;
      excludedOptOut: number;
      excludedStaleConsent: number;
    }
  | { error: string };

type CreatedSmsSend =
  | {
      sendId: number;
      messages: { id: number; recipientId: number | null }[];
      eligible: EvaluatedRecipient[];
      summary: RecipientEvaluation['summary'];
    }
  | { error: string };

// Campaign-scoped advisory lock shared by launch AND import (0105): a
// re-import can't swap the recipient list between a launch's evaluation and
// its message-row creation, and two launches can't double-send. Transaction-
// scoped, so it releases on commit/rollback.
async function lockCampaignSmsTx(
  tx: Parameters<Parameters<(typeof db)['transaction']>[0]>[0],
  campaignId: number,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('sms_launch_' || ${campaignId}::text))`,
  );
}

// The SMS panel lives on the event (campaign) detail surface under /calendar
// (0104 workflow hub); dealership pages show campaign summaries too, and the
// global inbox (0107) aggregates every thread.
function revalidateSmsViews() {
  revalidatePath('/calendar');
  revalidatePath('/dealerships');
  revalidatePath('/messages');
}

function parseId(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Dealer lists are a few hundred to low thousands of rows — 1 MB of CSV is
// ~15k rows, far past any real list; bigger files are almost certainly the
// wrong file picked.
const MAX_CSV_BYTES = 1_000_000;

// Replaces the campaign's imported list wholesale (D2: the list is a
// per-campaign snapshot of the dealer's data — a re-import IS the new list).
// All-or-nothing: any invalid row rejects the file (see import-csv.ts).
// validation: skip — inputs are an id (`parseId`) + a File; every CSV row is
// zod-safeParsed in `parseRecipientsCsv` (import-csv.ts), outside this file's
// AST so the lint rule can't see it.
export const importSmsRecipients = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ImportRecipientsResult> => {
    const campaignId = parseId(formData, 'campaignId');
    if (campaignId == null) return { error: 'Invalid campaign id.' };

    const file = formData.get('file');
    if (!(file instanceof File)) return { error: 'No CSV file supplied.' };
    if (file.size > MAX_CSV_BYTES) {
      return { error: 'CSV is larger than 1 MB — is this the right file?' };
    }

    const campaign = await loadSmsCampaignContext(campaignId);
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.status === 'cancelled') {
      return { error: 'Recipients cannot be imported onto a cancelled campaign.' };
    }

    const parsed = parseRecipientsCsv(await file.text());
    if ('error' in parsed) return parsed;

    const userId = ctx.user.id;
    await db.transaction(async (tx) => {
      await lockCampaignSmsTx(tx, campaignId);
      await tx.delete(smsRecipients).where(eq(smsRecipients.campaignId, campaignId));
      await tx.insert(smsRecipients).values(
        parsed.rows.map((row) => ({
          campaignId,
          phone: row.phone,
          firstName: row.firstName,
          lastName: row.lastName,
          consentBasis: row.consentBasis,
          lastContactAt: row.lastContactAt,
          // 0105: verification-only person-continuity fingerprint (null when
          // the key is unset or the row is nameless).
          identityHmac: computeIdentityHmac(row),
          createdById: userId,
          updatedById: userId,
        })),
      );
    });

    await recordAudit({
      action: 'sms.recipients_imported',
      targetTable: 'sms_recipients',
      targetId: campaignId,
      payload: { imported: parsed.rows.length, duplicatesDropped: parsed.duplicatesDropped },
    });

    revalidateSmsViews();
    return { ok: true, imported: parsed.rows.length, duplicatesDropped: parsed.duplicatesDropped };
  });

const launchSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
  body: z.string().trim().min(1, 'Message body is required.'),
});

// CASL requires visible opt-out instructions on commercial texts. Appended at
// launch (and stored on the send row, so the ledger shows exactly what went
// out) unless the composer already mentions STOP.
function withStopFooter(body: string): string {
  return /\bSTOP\b/i.test(body) ? body : `${body}\nReply STOP to opt out.`;
}

// Launch = persist first, dispatch second. The send row + one message row per
// eligible recipient are created in a transaction BEFORE any Twilio call, so
// every dispatch attempt has a ledger row; each Twilio accept stamps
// `provider_sid` onto its row (create-failures stamp `failed` + the error).
// A crash mid-dispatch leaves the tail rows `queued` with no sid — visible in
// the send log rather than silently double-sendable: a re-launch is a NEW
// send, never a re-dispatch of existing rows.
export const launchSmsSend = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<LaunchSmsResult> => {
    const parsed = launchSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid launch input.' };
    }
    const { campaignId } = parsed.data;
    const body = withStopFooter(parsed.data.body);
    if (body.length > 1600) {
      return {
        error:
          'Message body is too long after adding the opt-out footer. Keep it to 1577 characters, or include STOP instructions yourself for a 1600 character limit.',
      };
    }

    const campaign = await loadSmsCampaignContext(campaignId);
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.status !== 'booked') {
      return {
        error: `SMS can only be sent for booked campaigns (current status: ${campaign.status}).`,
      };
    }
    // D1: the add-on gate — digital touches on the accepted quote.
    if ((campaign.smsEmail ?? 0) <= 0) {
      return {
        error:
          'This campaign has no Digital (SMS / Email) touches on its accepted quote — the SMS add-on is not active.',
      };
    }

    // Status callbacks ride SITE_URL (operator-configured origin — never the
    // request Host, same posture as share-link emails). Only attached when the
    // origin is public https: Twilio rejects the whole messages.create call
    // (21609) for localhost/plain-http callback URLs, so a dev env with
    // SITE_URL=http://localhost:3000 must send WITHOUT a callback (messages
    // stay `queued` locally) rather than fail every dispatch.
    const origin = process.env.SITE_URL?.trim().replace(/\/$/, '');
    const statusCallbackUrl = origin?.startsWith('https://')
      ? `${origin}/api/twilio/webhook`
      : undefined;

    const userId = ctx.user.id;
    const created: CreatedSmsSend = await db.transaction(async (tx): Promise<CreatedSmsSend> => {
      await lockCampaignSmsTx(tx, campaignId);
      const [recentSend] = await tx
        .select({ id: smsSends.id })
        .from(smsSends)
        .where(
          and(
            eq(smsSends.campaignId, campaignId),
            gte(smsSends.createdAt, sql<Date>`now() - interval '60 seconds'`),
          ),
        )
        .limit(1);
      if (recentSend) {
        return {
          error: 'A send for this campaign was just launched — check the send log before launching again.',
        };
      }

      // Evaluate INSIDE the locked transaction (0105): a concurrent re-import
      // takes the same campaign lock, so the list the review promised is the
      // list the send row + message snapshots are built from — no stale
      // in-memory recipient set.
      const { recipients, summary } = await evaluateCampaignRecipients(
        campaignId,
        new Date(),
        tx,
      );
      if (summary.total === 0) {
        return { error: 'No recipients imported for this campaign yet.' };
      }
      const eligible = recipients.filter((r) => r.eligibility.eligible);
      if (!eligible.length) {
        return {
          error: `All ${summary.total} recipients are excluded (${summary.excludedOptOut} opted out, ${summary.excludedStaleConsent} stale consent).`,
        };
      }

      const [send] = await tx
        .insert(smsSends)
        .values({
          campaignId,
          body,
          totalRecipients: summary.total,
          excludedOptOut: summary.excludedOptOut,
          excludedStaleConsent: summary.excludedStaleConsent,
          createdById: userId,
          updatedById: userId,
        })
        .returning({ id: smsSends.id });
      const messages = await tx
        .insert(smsMessages)
        .values(
          eligible.map((r) => ({
            sendId: send.id,
            recipientId: r.id,
            phone: r.phone,
            // 0105 send-event snapshots: the ledger stays a self-sufficient
            // CASL defense record (consent basis + the last-contact date it
            // was measured from) + person-continuity fingerprint, all of
            // which survive the 24-month recipient purge.
            consentBasis: r.consentBasis,
            lastContactAt: r.lastContactAt,
            identityHmac: r.identityHmac,
          })),
        )
        .returning({ id: smsMessages.id, recipientId: smsMessages.recipientId });
      return { sendId: send.id, messages, eligible, summary };
    });
    if (!('sendId' in created)) return created;
    const { eligible, summary } = created;

    // Sequential dispatch (intent open question #5: list sizes are hundreds —
    // a simple loop within the request is fine for v1; Twilio's Messaging
    // Service queues on its side).
    const byId = new Map(eligible.map((r) => [r.id, r]));
    let accepted = 0;
    let failed = 0;
    let optedOutDuringDispatch = 0;
    for (const message of created.messages) {
      const recipient = message.recipientId != null ? byId.get(message.recipientId) : null;
      if (!recipient) continue;
      const [optOut] = await db
        .select({ id: smsOptOuts.id })
        .from(smsOptOuts)
        .where(eq(smsOptOuts.phone, recipient.phone))
        .limit(1);
      if (optOut) {
        optedOutDuringDispatch++;
        await db
          .update(smsMessages)
          .set({
            status: 'failed',
            errorCode: 'opted_out_before_dispatch',
            statusUpdatedAt: new Date(),
          })
          .where(eq(smsMessages.id, message.id));
        continue;
      }
      const rendered = renderSmsBody(body, {
        firstName: recipient.firstName,
        lastName: recipient.lastName,
        dealerName: campaign.dealerName,
      });
      const result = await sendSms({
        to: recipient.phone,
        body: rendered,
        statusCallbackUrl,
      });
      if ('ok' in result) {
        accepted++;
        await db
          .update(smsMessages)
          .set({ providerSid: result.sid })
          .where(eq(smsMessages.id, message.id));
      } else {
        failed++;
        await db
          .update(smsMessages)
          .set({ status: 'failed', errorCode: result.error, statusUpdatedAt: new Date() })
          .where(eq(smsMessages.id, message.id));
      }
    }

    // Keep the persisted send snapshot in agreement with what actually
    // happened: an opt-out that raced in between evaluation and dispatch is an
    // EXCLUSION on the parent row (its message row carries the
    // `opted_out_before_dispatch` detail), so the send log and the launch
    // result can never disagree about the excluded count.
    const excludedOptOut = summary.excludedOptOut + optedOutDuringDispatch;
    if (optedOutDuringDispatch > 0) {
      await db
        .update(smsSends)
        .set({ excludedOptOut })
        .where(eq(smsSends.id, created.sendId));
    }

    await recordAudit({
      action: 'sms.launched',
      targetTable: 'sms_sends',
      targetId: created.sendId,
      payload: {
        campaignId,
        accepted,
        failed,
        excludedOptOut,
        excludedStaleConsent: summary.excludedStaleConsent,
      },
    });

    revalidateSmsViews();
    return {
      ok: true,
      sendId: created.sendId,
      accepted,
      failed,
      excludedOptOut,
      excludedStaleConsent: summary.excludedStaleConsent,
    };
  });

const replySchema = z.object({
  threadId: z.coerce.number().int().positive(),
  body: z.string().trim().min(1, 'Reply text is required.').max(1600, 'Replies are capped at 1600 characters.'),
  // Provenance only (D1/D4): the reply text originated as an approved AI
  // draft (possibly edited). FormData carries strings, so the flag is the
  // literal 'true' — anything else reads as staff-authored.
  aiDrafted: z.literal('true').optional(),
});

// Staff reply into a conversation thread (0106 Phase 3). The heavy lifting —
// opt-out recheck, persist-first outbound row, dev-redirected dispatch via
// `sendSms` — lives in `sendThreadReply` (src/lib/sms/conversations.ts) so the
// integration tests can drive it without the capability wrapper.
export const replyToThread = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const parsed = replySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid reply input.' };
    }

    const result = await sendThreadReply({
      threadId: parsed.data.threadId,
      body: parsed.data.body,
      userId: ctx.user.id,
      aiDrafted: parsed.data.aiDrafted === 'true',
    });
    if ('error' in result) return result;

    await recordAudit({
      action: 'sms.thread_replied',
      targetTable: 'sms_thread_messages',
      targetId: result.messageId,
      payload: { threadId: parsed.data.threadId, aiDrafted: parsed.data.aiDrafted === 'true' },
    });

    revalidateSmsViews();
    return { ok: true };
  });

const threadIdSchema = z.object({
  threadId: z.coerce.number().int().positive(),
});

export type DraftReplyResult = { ok: true; draft: string } | { error: string };

// AI-drafted reply suggestion (0106 Phase 4, D1 draft-and-approve). Returns
// TEXT for the console's reply box — never sends. The staff member edits or
// discards freely; sending goes through `replyToThread` with the aiDrafted
// provenance flag. Drafts are constrained to campaign facts inside
// `draftSmsReply`'s prompt; no audit entry because nothing is mutated.
export const draftThreadReply = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<DraftReplyResult> => {
    const parsed = threadIdSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid thread id.' };
    }

    const context = await loadThreadDraftContext(parsed.data.threadId);
    if (!context) return { error: 'Conversation not found.' };
    if (context.optedOut) {
      return { error: 'This number has opted out (STOP) — no reply can be sent, so there is nothing to draft.' };
    }
    if (!context.messages.some((m) => m.direction === 'inbound')) {
      return { error: 'Nothing to reply to yet — the conversation has no inbound message.' };
    }

    return draftSmsReply({
      dealerName: context.dealerName,
      eventDates: eventDatesLabel(context.startDate, context.endDate),
      conversation: context.messages,
    });
  });

// Matches the sms page's date label ("Aug 1 – Aug 2, 2026") so the AI states
// the event dates the same way the rest of the surface renders them.
function eventDatesLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  return startIso === endIso ? fmt(startIso) : `${fmt(startIso)} – ${fmt(endIso)}`;
}

// Clears the thread's unread marker (single global read pointer, v1).
export const markThreadRead = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const parsed = threadIdSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid thread id.' };
    }

    const updated = await db
      .update(smsThreads)
      .set({ lastReadAt: new Date(), updatedById: ctx.user.id })
      .where(eq(smsThreads.id, parsed.data.threadId))
      .returning({ id: smsThreads.id });
    if (!updated.length) return { error: 'Conversation not found.' };

    revalidateSmsViews();
    return { ok: true };
  });

export type InboxUnreadCountResult = { ok: true; count: number };

// Nav-badge poll (0107): how many threads have unread inbound. Read-only —
// reads triggered by our own UI go through a Server Action like everything
// else (route handlers are external-callers-only per conventions).
// validation: skip — takes no input; returns a count only.
export const getInboxUnreadCount = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async (): Promise<InboxUnreadCountResult> => {
    return { ok: true, count: await loadInboxUnreadCount() };
  });

const reassignSchema = z.object({
  threadId: z.coerce.number().int().positive(),
  campaignId: z.coerce.number().int().positive(),
});

// D2: attribution defaults to most-recent-send and can guess wrong when a
// number is on several campaigns — staff move the whole thread to the right
// one. Refuses (rather than merges) when the target campaign already has a
// thread for the number — the unique (campaign_id, phone) index backstops a
// race on that check.
export const reassignThread = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const parsed = reassignSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid reassignment input.' };
    }
    const { threadId, campaignId } = parsed.data;

    const [thread] = await db
      .select({ phone: smsThreads.phone })
      .from(smsThreads)
      .where(eq(smsThreads.id, threadId))
      .limit(1);
    if (!thread) return { error: 'Conversation not found.' };

    const [target] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!target) return { error: 'Target campaign not found.' };

    const [sendHistory] = await db
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .innerJoin(smsSends, eq(smsSends.id, smsMessages.sendId))
      .where(and(eq(smsSends.campaignId, campaignId), eq(smsMessages.phone, thread.phone)))
      .limit(1);
    if (!sendHistory) {
      return {
        error:
          'That campaign has never texted this number — reassignment is limited to campaigns that have.',
      };
    }

    try {
      const updated = await db
        .update(smsThreads)
        .set({ campaignId, updatedById: ctx.user.id })
        .where(eq(smsThreads.id, threadId))
        .returning({ id: smsThreads.id });
      if (!updated.length) return { error: 'Conversation not found.' };
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === '23505') {
        return {
          error:
            'That campaign already has a conversation with this number — reassignment would collide with it.',
        };
      }
      throw err;
    }

    await recordAudit({
      action: 'sms.thread_reassigned',
      targetTable: 'sms_threads',
      targetId: threadId,
      payload: { campaignId },
    });

    revalidateSmsViews();
    return { ok: true };
  });

const optOutSchema = z.object({
  phone: z.string().trim().min(1, 'Phone number is required.'),
});

// Manual opt-out entry (a customer asks the dealer / calls the office instead
// of replying STOP). Permanent + global, like the webhook-recorded kind.
export const addSmsOptOut = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const parsed = optOutSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid phone number.' };
    }
    const phone = normalizePhoneE164(parsed.data.phone);
    if (!phone) return { error: `"${parsed.data.phone}" is not a valid phone number.` };

    // Idempotent: an already-opted-out number is a no-op, not an error.
    await db
      .insert(smsOptOuts)
      .values({
        phone,
        source: 'manual',
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      })
      .onConflictDoNothing({ target: smsOptOuts.phone });

    await recordAudit({
      action: 'sms.opt_out_recorded',
      targetTable: 'sms_opt_outs',
      targetId: null,
      payload: { source: 'manual' },
    });

    revalidateSmsViews();
    return { ok: true };
  });
