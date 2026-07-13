'use server';

import { and, eq, gte, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { recordAudit } from '@/features/audit/actions';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { db } from '@/lib/db';
import { smsMessages, smsOptOuts, smsRecipients, smsSends } from '@/lib/db/schema';
import { sendSms } from '@/lib/sms/send';
import { renderSmsBody } from '@/lib/sms/template';
import { normalizePhoneE164, parseRecipientsCsv } from './import-csv';
import { evaluateCampaignRecipients, loadSmsCampaignContext } from './queries';

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
  | { sendId: number; messages: { id: number; recipientId: number | null }[] }
  | { error: string };

// The SMS panel lives on the event (campaign) detail surface under /calendar
// (0104 workflow hub); dealership pages show campaign summaries too.
function revalidateSmsViews() {
  revalidatePath('/calendar');
  revalidatePath('/dealerships');
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
      await tx.delete(smsRecipients).where(eq(smsRecipients.campaignId, campaignId));
      await tx.insert(smsRecipients).values(
        parsed.rows.map((row) => ({
          campaignId,
          phone: row.phone,
          firstName: row.firstName,
          lastName: row.lastName,
          consentBasis: row.consentBasis,
          lastContactAt: row.lastContactAt,
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

    const { recipients, summary } = await evaluateCampaignRecipients(campaignId);
    if (summary.total === 0) {
      return { error: 'No recipients imported for this campaign yet.' };
    }
    const eligible = recipients.filter((r) => r.eligibility.eligible);
    if (!eligible.length) {
      return {
        error: `All ${summary.total} recipients are excluded (${summary.excludedOptOut} opted out, ${summary.excludedStaleConsent} stale consent).`,
      };
    }

    // Status callbacks ride SITE_URL (operator-configured origin — never the
    // request Host, same posture as share-link emails). Absent in local dev →
    // no callback; messages simply stay `queued`.
    const origin = process.env.SITE_URL?.trim().replace(/\/$/, '');
    const statusCallbackUrl = origin ? `${origin}/api/twilio/webhook` : undefined;

    const userId = ctx.user.id;
    const created: CreatedSmsSend = await db.transaction(async (tx): Promise<CreatedSmsSend> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('sms_launch_' || ${campaignId}::text))`,
      );
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
          })),
        )
        .returning({ id: smsMessages.id, recipientId: smsMessages.recipientId });
      return { sendId: send.id, messages };
    });
    if (!('sendId' in created)) return created;

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
