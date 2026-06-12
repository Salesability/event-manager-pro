import type { GcalAttendee, GcalEventInput } from './calendar';

// Pure campaign → Google Calendar event mapper (chunk 0077, Phase 2). Mirrors
// the shape of ../quickbooks/quote-push.ts `mapQuoteToEstimate`: a DB-free,
// unit-testable inverse-map from a domain record to an external-API payload.
// The Server Action (Phase 4) resolves these inputs from the DB and passes the
// absolute `appLink` (it owns the route choice — there's no per-campaign deep
// route today, so it links to /calendar). Keeping this module pure means no
// `server-only` import and no env reads, so the type import below is type-only.
//
// Customer-safe by construction (decision.md §5): the dealer is a guest on this
// event, so the description carries ONLY coach / format / dealer-contact +
// app link — never the internal ops fields (qty_records, sms_email, letters,
// bdc, audience source) that the legacy hand-typed invite leaked.

export type GcalCampaign = {
  id: number;
  publicId: string;
  /** Inclusive event start, 'YYYY-MM-DD' (the DB `campaigns.start_date`). */
  startDate: string;
  /** Inclusive event end, 'YYYY-MM-DD' (the DB `campaigns.end_date`). */
  endDate: string;
  /** The campaign's format (campaign_styles.label), resolved by the caller. */
  styleLabel: string | null;
  /** Day-of dealer contact name / phone / email (campaigns.{contact,phone,email}). */
  contact: string | null;
  phone: string | null;
  email: string | null;
};

export type GcalCampaignDealer = { name: string; address: string | null };

export type GcalCampaignCoach = {
  name: string | null;
  /** Resolved from auth.users via contacts.user_id (Phase 4); null = no invite. */
  email: string | null;
  /** Google's fixed palette id '1'..'11' for colour-by-coach; null = calendar default. */
  colorId: string | null;
};

/** Add `days` to a 'YYYY-MM-DD' date in UTC (timezone-safe, no DST drift). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Pure: campaign + dealer + coach + app link → Calendar event write payload.
// All-day event, so `end.date` is EXCLUSIVE — our DB `endDate` is the inclusive
// last day, so the Google end is `endDate + 1`. `attendees` is always set (even
// empty) so a Phase-4 patch fully reconciles the guest list on a coach/contact
// change rather than leaving a stale invite.
export function mapCampaignToGcalEvent(
  campaign: GcalCampaign,
  dealer: GcalCampaignDealer,
  coach: GcalCampaignCoach,
  appLink: string,
): GcalEventInput {
  const lines: string[] = [];
  if (coach.name) lines.push(`Coach: ${coach.name}`);
  if (campaign.styleLabel) lines.push(`Format: ${campaign.styleLabel}`);
  const contactBits = [campaign.contact, campaign.phone].filter(Boolean).join(' · ');
  if (contactBits) lines.push(`Dealer contact: ${contactBits}`);
  if (lines.length) lines.push(''); // blank separator before the link
  lines.push(`View in SaleDay: ${appLink}`);

  const attendees: GcalAttendee[] = [];
  if (coach.email) {
    // The coach works the event — pre-accept so it lands as confirmed, not a
    // pending RSVP (these events are pre-contracted, not "please confirm").
    attendees.push({
      email: coach.email,
      displayName: coach.name ?? undefined,
      responseStatus: 'accepted',
    });
  }
  if (campaign.email) {
    attendees.push({
      email: campaign.email,
      displayName: campaign.contact ?? undefined,
    });
  }

  const event: GcalEventInput = {
    summary: `🚗 ${dealer.name} — SaleDay Event`,
    start: { date: campaign.startDate },
    end: { date: addDaysIso(campaign.endDate, 1) },
    description: lines.join('\n'),
    attendees,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 120 },
      ],
    },
    extendedProperties: { private: { campaignId: String(campaign.id) } },
    source: { title: 'SaleDay', url: appLink },
  };
  if (dealer.address) event.location = dealer.address;
  if (coach.colorId) event.colorId = coach.colorId;
  return event;
}
