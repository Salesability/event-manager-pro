import { describe, expect, it } from 'vitest';
import { testEmailFormSchema } from './test-email-schema';

// Validation contract for the admin Send Test Email form (0064). The form
// component is hook-driven, and this repo has no jsdom/RTL harness (vitest
// runs in the `node` environment), so the form's behaviour is pinned at the
// schema layer — the same contract `zodResolver` and the Server Action's
// `safeParse` both run against.

describe('testEmailFormSchema', () => {
  it('accepts a well-formed message and trims every field', () => {
    const parsed = testEmailFormSchema.safeParse({
      to: '  dest@example.test  ',
      subject: '  Hello  ',
      body: '  A body.  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        to: 'dest@example.test',
        subject: 'Hello',
        body: 'A body.',
      });
    }
  });

  it('rejects an invalid recipient address', () => {
    const parsed = testEmailFormSchema.safeParse({
      to: 'not-an-email',
      subject: 'Hi',
      body: 'Body',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a whitespace-only subject', () => {
    const parsed = testEmailFormSchema.safeParse({
      to: 'dest@example.test',
      subject: '   ',
      body: 'Body',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty body', () => {
    const parsed = testEmailFormSchema.safeParse({
      to: 'dest@example.test',
      subject: 'Hi',
      body: '',
    });
    expect(parsed.success).toBe(false);
  });
});
