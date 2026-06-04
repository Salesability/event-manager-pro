'use server';

import {
  capabilityClient,
  formDataSchema,
} from '@/lib/actions/action-client';
import { sendEmail } from '@/lib/email/send';
import {
  clientConfirmation,
  coachConfirmation,
  coachShareLink,
} from '@/lib/email/templates';
import { loadCampaign, loadCampaigns, loadCoach } from '@/features/schedule/queries';
import { testEmailFormSchema } from './test-email-schema';
import type { User } from '@supabase/supabase-js';

type ActionResult = { ok: true } | { error: string };

// Test-email send surfaces the Resend message id (it's a deliverability tool —
// the id is the proof of send). Distinct from `ActionResult`, which the
// confirmation sends use since their callers don't display the id.
type TestEmailResult = { ok: true; id: string } | { error: string };

type FieldErrors = Record<string, string[] | undefined>;
function firstFieldError(fieldErrors: FieldErrors): string | undefined {
  for (const list of Object.values(fieldErrors)) {
    if (list && list.length) return list[0];
  }
  return undefined;
}

// Pulls the sender's email off the authed ctx.user. Replaces the imperative
// `requireSenderEmail()` helper from pre-0033, which itself called
// `assertCan('email:send')` — that check now lives in the
// `capabilityClient('email:send')` middleware.
function senderEmailOrError(user: User): string | { error: string } {
  if (!user.email) return { error: 'No email on file for the signed-in account.' };
  return user.email;
}

// Canonical origin for share links emailed to coaches/clients. Reads from
// `process.env.SITE_URL` (operator-configured per deploy) — never from the
// request `Host` header, which an attacker controlling the proxy could spoof
// to plant a phishing URL inside an outbound email. Returns `{ error }` if
// unconfigured so the caller can surface the misconfig instead of falling
// back to a header. Closes the parked Codex High from
// `shipped/0011-email-send/eval-2026-05-01-1609.md` ("Share-link email trusts
// request Host"). The operator-set env var IS the allowlist.
function siteUrl(): string | { error: string } {
  const explicit = process.env.SITE_URL?.trim().replace(/\/$/, '');
  if (!explicit) {
    return {
      error:
        'SITE_URL is not configured. Set it to the canonical origin for this deploy.',
    };
  }
  return explicit;
}

function parseId(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Admin deliverability tool (0064): free-compose a plain-text email to any
// address and surface the Resend message id. Object-schema validated; reuses
// the shared `sendEmail()` path, so the non-prod dev-redirect gate still
// applies (recipient rewritten to EMAIL_DEV_TO + `[DEV→…]` subject prefix).
export const sendTestEmail = capabilityClient('email:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<TestEmailResult> => {
    const replyTo = senderEmailOrError(ctx.user);
    if (typeof replyTo !== 'string') return replyTo;

    const parsed = testEmailFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return { error: firstFieldError(fieldErrors) ?? 'Invalid email input.' };
    }
    const { to, subject, body } = parsed.data;

    const result = await sendEmail({ to, subject, text: body, replyTo });
    return 'ok' in result ? { ok: true, id: result.id } : { error: result.error };
  });

// validation: skip — id-only action (campaignId); local `parseId` covers it.
export const sendClientCampaignConfirmation = capabilityClient('email:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const replyTo = senderEmailOrError(ctx.user);
    if (typeof replyTo !== 'string') return replyTo;

    const id = parseId(formData, 'campaignId');
    if (id == null) return { error: 'Invalid campaign id.' };

    const campaign = await loadCampaign(id);
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.status !== 'booked') {
      return {
        error: `Confirmation can only be sent for booked campaigns (current status: ${campaign.status}).`,
      };
    }

    const to = campaign.email?.trim();
    if (!to) return { error: 'No client email on file for this campaign.' };

    const coach = campaign.coachId ? await loadCoach(campaign.coachId) : null;

    const { subject, text } = clientConfirmation({
      contact: campaign.contact ?? '',
      dealerName: campaign.dealerName,
      dealerAddress: campaign.dealerAddress,
      phone: campaign.phone ?? '',
      email: to,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      styleLabel: campaign.styleLabel,
      audienceSourceLabel: campaign.audienceSourceLabel,
      coachFullName: coach ? `${coach.firstName} ${coach.lastName}` : null,
      coachPhone: coach?.primaryPhone ?? null,
      coachEmail: coach?.primaryEmail ?? null,
      qtyRecords: campaign.qtyRecords,
      smsEmail: campaign.smsEmail,
      letters: campaign.letters,
      bdc: campaign.bdc != null ? String(campaign.bdc) : null,
      notes: campaign.notes,
    });

    const result = await sendEmail({ to, subject, text, replyTo });
    return 'ok' in result ? { ok: true } : { error: result.error };
  });

// validation: skip — id-only action (campaignId); local `parseId` covers it.
export const sendCoachCampaignConfirmation = capabilityClient('email:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const replyTo = senderEmailOrError(ctx.user);
    if (typeof replyTo !== 'string') return replyTo;

    const id = parseId(formData, 'campaignId');
    if (id == null) return { error: 'Invalid campaign id.' };

    const campaign = await loadCampaign(id);
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.status !== 'booked') {
      return {
        error: `Confirmation can only be sent for booked campaigns (current status: ${campaign.status}).`,
      };
    }
    if (!campaign.coachId) return { error: 'No coach assigned to this campaign.' };

    const coach = await loadCoach(campaign.coachId);
    const to = coach?.primaryEmail?.trim();
    if (!coach || !to) return { error: 'No email on file for the assigned coach.' };

    const { subject, text } = coachConfirmation({
      coachFirstName: coach.firstName,
      dealerName: campaign.dealerName,
      dealerAddress: campaign.dealerAddress,
      contact: campaign.contact ?? '',
      phone: campaign.phone ?? '',
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      styleLabel: campaign.styleLabel,
      audienceSourceLabel: campaign.audienceSourceLabel,
      qtyRecords: campaign.qtyRecords,
      smsEmail: campaign.smsEmail,
      letters: campaign.letters,
      bdc: campaign.bdc != null ? String(campaign.bdc) : null,
      notes: campaign.notes,
    });

    const result = await sendEmail({ to, subject, text, replyTo });
    return 'ok' in result ? { ok: true } : { error: result.error };
  });

// validation: skip — id-only action (coachId); local `parseId` covers it.
export const sendCoachShareLinkEmail = capabilityClient('email:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const replyTo = senderEmailOrError(ctx.user);
    if (typeof replyTo !== 'string') return replyTo;

    const id = parseId(formData, 'coachId');
    if (id == null) return { error: 'Invalid coach id.' };

    const coach = await loadCoach(id);
    const to = coach?.primaryEmail?.trim();
    if (!coach || !to) return { error: 'No email on file for this coach.' };

    const today = new Date().toISOString().slice(0, 10);
    const all = await loadCampaigns();
    const upcoming = all
      .filter((c) => c.coachId === id && c.status !== 'cancelled' && c.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const origin = siteUrl();
    if (typeof origin !== 'string') return origin;
    const shareUrl = `${origin}/share/coach/${coach.id}`;

    const { subject, text } = coachShareLink({
      coachFirstName: coach.firstName,
      shareUrl,
      campaigns: upcoming.map((c) => ({
        dealerName: c.dealerName,
        startDate: c.startDate,
        endDate: c.endDate,
      })),
    });

    const result = await sendEmail({ to, subject, text, replyTo });
    return 'ok' in result ? { ok: true } : { error: result.error };
  });
