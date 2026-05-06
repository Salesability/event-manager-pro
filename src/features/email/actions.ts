'use server';

import { requireRole } from '@/lib/auth/require-role';
import { sendEmail } from '@/lib/email/send';
import {
  clientConfirmation,
  coachConfirmation,
  coachShareLink,
} from '@/lib/email/templates';
import { loadCampaign, loadCampaigns, loadCoach } from '@/features/schedule/queries';

type ActionResult = { ok: true } | { error: string };

async function requireSenderEmail(): Promise<string | { error: string }> {
  const user = await requireRole(['admin', 'staff', 'coach']);
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

export async function sendClientCampaignConfirmation(formData: FormData): Promise<ActionResult> {
  const replyTo = await requireSenderEmail();
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
    salesLeadSourceLabel: campaign.salesLeadSourceLabel,
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
}

export async function sendCoachCampaignConfirmation(formData: FormData): Promise<ActionResult> {
  const replyTo = await requireSenderEmail();
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
    salesLeadSourceLabel: campaign.salesLeadSourceLabel,
    qtyRecords: campaign.qtyRecords,
    smsEmail: campaign.smsEmail,
    letters: campaign.letters,
    bdc: campaign.bdc != null ? String(campaign.bdc) : null,
    notes: campaign.notes,
  });

  const result = await sendEmail({ to, subject, text, replyTo });
  return 'ok' in result ? { ok: true } : { error: result.error };
}

export async function sendCoachShareLinkEmail(formData: FormData): Promise<ActionResult> {
  const replyTo = await requireSenderEmail();
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
}
