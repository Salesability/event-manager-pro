import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

// AI-drafted SMS replies (0106 Phase 4) — the repo's first LLM surface.
// Draft-and-approve only (D1): this module produces a SUGGESTION for the
// conversation console; a staff member approves/edits/discards it, and the
// send rides the normal `sendThreadReply` path (opt-out recheck included).
// Nothing here can send a message. Mirrors the vendor-client shape of
// `src/lib/sms/client.ts`: env-keyed cached client, `{ok}|{error}` result,
// graceful degradation when the key is unset.

export type DraftSmsReplyInput = {
  dealerName: string;
  /** Human-readable event date(s), e.g. "Aug 1 – Aug 2, 2026". */
  eventDates: string;
  /** Full thread, oldest first. Inbound = the customer, outbound = us. */
  conversation: Array<{ direction: 'inbound' | 'outbound'; body: string }>;
};

export type DraftSmsReplyResult = { ok: true; draft: string } | { error: string };

let cached: Anthropic | null = null;

function client(): { ok: true; client: Anthropic } | { error: string } {
  if (cached) return { ok: true, client: cached };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY is not set — AI drafting is unavailable.' };
  cached = new Anthropic({ apiKey });
  return { ok: true, client: cached };
}

export function __resetForTests() {
  cached = null;
}

// The draft is constrained to campaign facts (intent success criterion: the
// AI never asserts facts outside the campaign context). Everything the model
// may state is in this prompt; anything else must be deferred to the team.
export function buildDraftPrompt(input: DraftSmsReplyInput): {
  system: string;
  user: string;
} {
  const system = [
    'You draft SMS replies for a car dealership\'s sales-event team. A customer',
    'received a campaign text inviting them to book an appointment at a private',
    'sales event and has replied; you draft the team\'s next message. A staff',
    'member reviews and edits your draft before anything sends — but write it',
    'ready to send as-is.',
    '',
    'The only facts you may state:',
    `- Dealership: ${input.dealerName}`,
    `- Event date(s): ${input.eventDates}`,
    '- Appointments are booked by replying to this conversation.',
    '',
    'Hard rules:',
    '- Never invent prices, discounts, inventory, trade-in values, financing',
    '  terms, opening hours, or addresses. If the customer asks about any of',
    '  those, say a team member will confirm the details.',
    '- Goal: capture their appointment intent — ask for a day/time preference',
    '  when they show interest.',
    '- If they are not interested, thank them briefly and do not push.',
    '- Match the customer\'s language if it is not English.',
    '- One SMS only: plain text, under 300 characters, no emoji, no links,',
    '  no sign-off block.',
    '',
    'Reply with the SMS text only — no preamble, no quotes, no explanation.',
  ].join('\n');

  const transcript = input.conversation
    .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Dealership'}: ${m.body}`)
    .join('\n');
  const user = `Conversation so far:\n${transcript}\n\nDraft the dealership's next reply.`;

  return { system, user };
}

export async function draftSmsReply(
  input: DraftSmsReplyInput,
): Promise<DraftSmsReplyResult> {
  const c = client();
  if ('error' in c) return c;

  const { system, user } = buildDraftPrompt(input);
  try {
    const response = await c.client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') {
      return { error: 'The AI declined to draft a reply for this conversation.' };
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) return { error: 'The AI returned an empty draft.' };
    return { ok: true, draft: text };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'AI draft request failed.',
    };
  }
}
