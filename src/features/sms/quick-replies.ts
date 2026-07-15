// Canned quick replies for the conversation composer (0110). Curated v1 set
// drawn from the competitor review (owner call 2026-07-15) — an admin editor
// is a follow-up if the fixed set chafes. Tapping a chip fills the reply box
// verbatim; staff edit/send through the normal `replyToThread` path, so
// bodies must stand alone: plain text, no template variables (replies never
// run the launch renderer), no invented facts (prices, hours, addresses).
// Plain module (no 'use client') so tests import it without the panel.

export type QuickReply = {
  /** Short chip label the composer renders. */
  label: string;
  /** The full SMS text the chip fills into the reply box. */
  body: string;
};

export const QUICK_REPLIES: readonly QuickReply[] = [
  {
    label: 'Ask for a time',
    body: 'What day and time works best for you?',
  },
  {
    label: 'Morning or afternoon?',
    body: 'Would a morning or an afternoon appointment work better for you?',
  },
  {
    label: 'See you shortly',
    body: 'Terrific — we will see you shortly!',
  },
  {
    label: "You're booked",
    body: "You're all booked — we look forward to seeing you!",
  },
  {
    label: 'Missed you — reschedule?',
    body: 'Sorry we missed you — would you like to reschedule?',
  },
  {
    label: 'Will confirm details',
    body: 'Good question — a team member will confirm those details and get right back to you.',
  },
  {
    label: 'How can we help?',
    body: 'Thanks for reaching out — how can we help?',
  },
  {
    label: 'No problem',
    body: 'No problem at all — thanks for letting us know.',
  },
];
