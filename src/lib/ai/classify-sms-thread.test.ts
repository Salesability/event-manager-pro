import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock the vendor SDK — no real Anthropic call ever leaves a test.
const anthropicMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: anthropicMocks.create };
  },
}));

import {
  __resetForTests,
  buildClassifyPrompt,
  classifySmsThread,
} from './classify-sms-thread';

const INPUT = {
  conversation: [
    { direction: 'inbound' as const, body: 'interested — what time do you open?' },
    { direction: 'outbound' as const, body: 'We open at 9am!' },
    { direction: 'inbound' as const, body: 'great, book me for saturday morning' },
  ],
};

describe('buildClassifyPrompt', () => {
  it('pins the closed output contract and the untrusted-input boundary', () => {
    const { system } = buildClassifyPrompt(INPUT);
    expect(system).toContain('sentiment');
    expect(system).toContain('temperature');
    expect(system).toContain('untrusted customer input');
    expect(system).toContain('ONLY a single JSON object');
    expect(system).toContain('"positive|neutral|negative"');
    expect(system).toContain('"hot|warm|cold"');
  });

  it('renders the transcript oldest-first with speaker labels', () => {
    const { user } = buildClassifyPrompt(INPUT);
    expect(user).toContain(
      'Customer: interested — what time do you open?\nDealership: We open at 9am!\nCustomer: great, book me for saturday morning',
    );
    expect(user).toContain('Classify the customer.');
  });
});

describe('classifySmsThread', () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    __resetForTests();
    anthropicMocks.create.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    __resetForTests();
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('degrades gracefully when the key is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({ error: expect.stringContaining('ANTHROPIC_API_KEY') });
    expect(anthropicMocks.create).not.toHaveBeenCalled();
  });

  it('parses a clean JSON classification', async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"sentiment":"positive","temperature":"hot"}' }],
    });
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({
      ok: true,
      classification: { sentiment: 'positive', temperature: 'hot' },
    });
  });

  it('tolerates fenced/padded output around the JSON object', async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: '```json\n{"sentiment":"neutral","temperature":"warm"}\n```',
        },
      ],
    });
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({
      ok: true,
      classification: { sentiment: 'neutral', temperature: 'warm' },
    });
  });

  it('rejects out-of-vocabulary labels — the contract is the closed enums', async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"sentiment":"ecstatic","temperature":"hot"}' }],
    });
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({ error: expect.stringContaining('out-of-vocabulary') });
  });

  it('rejects prose with no JSON object', async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'The customer seems keen to book.' }],
    });
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({ error: expect.stringContaining('non-JSON') });
  });

  it('maps a refusal stop reason to a typed error before reading content', async () => {
    anthropicMocks.create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({ error: expect.stringContaining('declined') });
  });

  it('maps a thrown API error to the {error} result shape', async () => {
    anthropicMocks.create.mockRejectedValueOnce(new Error('rate_limit_error'));
    const result = await classifySmsThread(INPUT);
    expect(result).toEqual({ error: 'rate_limit_error' });
  });
});
