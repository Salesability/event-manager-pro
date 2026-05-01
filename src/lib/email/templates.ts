import 'server-only';

const RULE = '─────────────────────────────────────';

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const weekdayShortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const fmtNum = (n: number | null | undefined) =>
  n == null ? 'TBD' : Number(n).toLocaleString();

export type ClientConfirmationFields = {
  contact: string;
  dealerName: string;
  dealerAddress: string | null;
  phone: string;
  email: string;
  startDate: string;
  endDate: string;
  styleLabel: string | null;
  salesLeadSourceLabel: string | null;
  coachFullName: string | null;
  coachPhone: string | null;
  coachEmail: string | null;
  qtyRecords: number | null;
  smsEmail: number | null;
  letters: number | null;
  bdc: string | null;
  notes: string | null;
};

export function clientConfirmation(f: ClientConfirmationFields) {
  const subject = `Sales Event Confirmation — ${f.dealerName} — ${shortDate(f.startDate)}`;

  const coachBlock = f.coachFullName
    ? `${f.coachFullName}\nPhone: ${f.coachPhone ?? 'TBD'}\nEmail: ${f.coachEmail ?? 'TBD'}`
    : 'Sales Coach to be confirmed';

  const notesBlock = f.notes ? `\nNOTES\n${RULE}\n${f.notes}\n` : '';

  const text = `Dear ${f.contact || 'TBD'},

We are pleased to confirm your upcoming 3-Day Sales Event booking.

EVENT DETAILS
${RULE}
Dealership:     ${f.dealerName}
Location:       ${f.dealerAddress || 'TBD'}
Contact:        ${f.contact || 'TBD'}
Phone:          ${f.phone || 'TBD'}
Email:          ${f.email || 'TBD'}
Start Date:     ${longDate(f.startDate)}
End Date:       ${longDate(f.endDate)}
Event Format:   ${f.styleLabel || 'Standard Sales Event'}
Data Source:    ${f.salesLeadSourceLabel || 'TBD'}

ASSIGNED SALES COACH
${RULE}
${coachBlock}

MARKETING DETAILS
${RULE}
Qty of Records:  ${fmtNum(f.qtyRecords)}
SMS / Email:     ${fmtNum(f.smsEmail)}
Letters:         ${fmtNum(f.letters)}
BDC:             ${f.bdc || 'TBD'}
${notesBlock}
Please reply to confirm receipt of this booking.
We look forward to a successful event!

Best regards,
DealerEvent Pro Team`;

  return { subject, text };
}

export type CoachConfirmationFields = {
  coachFirstName: string;
  dealerName: string;
  dealerAddress: string | null;
  contact: string;
  phone: string;
  startDate: string;
  endDate: string;
  styleLabel: string | null;
  salesLeadSourceLabel: string | null;
  qtyRecords: number | null;
  smsEmail: number | null;
  letters: number | null;
  bdc: string | null;
  notes: string | null;
};

export function coachConfirmation(f: CoachConfirmationFields) {
  const subject = `Assignment Confirmation — ${f.dealerName} — ${shortDate(f.startDate)}`;
  const notesBlock = f.notes ? `\nNOTES\n${RULE}\n${f.notes}\n` : '';

  const text = `Hi ${f.coachFirstName},

You have been assigned to the following 3-Day Sales Event:

ASSIGNMENT DETAILS
${RULE}
Dealership:     ${f.dealerName}
Location:       ${f.dealerAddress || 'TBD'}
Contact:        ${f.contact || 'TBD'}
Phone:          ${f.phone || 'TBD'}
Start Date:     ${longDate(f.startDate)}
End Date:       ${longDate(f.endDate)}
Event Format:   ${f.styleLabel || 'Standard Sales Event'}
Data Source:    ${f.salesLeadSourceLabel || 'TBD'}

MARKETING TARGETS
${RULE}
Qty of Records:  ${fmtNum(f.qtyRecords)}
SMS / Email:     ${fmtNum(f.smsEmail)}
Letters:         ${fmtNum(f.letters)}
BDC:             ${f.bdc || 'TBD'}
${notesBlock}
Please confirm your availability by replying to this email.

Best regards,
DealerEvent Pro Team`;

  return { subject, text };
}

export type CoachShareLinkFields = {
  coachFirstName: string;
  shareUrl: string;
  campaigns: Array<{ dealerName: string; startDate: string; endDate: string }>;
};

export function coachShareLink(f: CoachShareLinkFields) {
  const subject = 'Your Sales Event Schedule — DealerEvent Pro';

  const eventList = f.campaigns.length
    ? f.campaigns
        .map(
          (c) =>
            `  • ${c.dealerName}: ${weekdayShortDate(c.startDate)} — ${weekdayShortDate(c.endDate)}`,
        )
        .join('\n')
    : '  No events booked yet.';

  const text = `Hi ${f.coachFirstName},

Here is your personalised calendar link showing all your upcoming sales event assignments:

${f.shareUrl}

Your upcoming events:
${eventList}

Click the link above to view your full schedule at any time. It will always show the most up-to-date information.

Best regards,
DealerEvent Pro`;

  return { subject, text };
}
