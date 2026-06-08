import { describe, expect, it } from 'vitest';
import { testMsaFormSchema } from './test-msa-schema';

// Contract test for the admin "Send Test MSA" form schema (chunk 0067). This
// is the shared contract that both `zodResolver` (client form) and the action's
// `safeParse(Object.fromEntries(formData))` enforce — pinning validation here
// covers both call sites (the repo has no jsdom/RTL for component render tests).

describe('testMsaFormSchema', () => {
  it('accepts a valid recipient + signer name + message, trimming whitespace', () => {
    const r = testMsaFormSchema.safeParse({
      to: '  buyer@dealer.test  ',
      signerName: '  Pat Buyer  ',
      message: '  please sign  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.to).toBe('buyer@dealer.test');
      expect(r.data.signerName).toBe('Pat Buyer');
      expect(r.data.message).toBe('please sign');
    }
  });

  it('accepts omitted (optional) message', () => {
    const r = testMsaFormSchema.safeParse({ to: 'a@b.co', signerName: 'A B' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty recipient', () => {
    const r = testMsaFormSchema.safeParse({ to: '   ', signerName: 'A B' });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(testMsaFormSchema.safeParse({ to: 'not-an-email', signerName: 'A B' }).success).toBe(false);
    expect(testMsaFormSchema.safeParse({ to: 'missing@dot', signerName: 'A B' }).success).toBe(false);
  });

  it('rejects a multi-recipient address list (comma / semicolon)', () => {
    expect(
      testMsaFormSchema.safeParse({ to: 'a@x.com,b@y.com', signerName: 'A B' }).success,
    ).toBe(false);
    expect(
      testMsaFormSchema.safeParse({ to: 'a@x.com;b@y.com', signerName: 'A B' }).success,
    ).toBe(false);
  });

  it('rejects an empty signer name', () => {
    const r = testMsaFormSchema.safeParse({ to: 'a@b.co', signerName: '   ' });
    expect(r.success).toBe(false);
  });

  it('rejects a signer name with control characters (CR/LF)', () => {
    const r = testMsaFormSchema.safeParse({ to: 'a@b.co', signerName: 'Pat\nBuyer' });
    expect(r.success).toBe(false);
  });

  it('rejects an over-length message', () => {
    const r = testMsaFormSchema.safeParse({
      to: 'a@b.co',
      signerName: 'A B',
      message: 'x'.repeat(1001),
    });
    expect(r.success).toBe(false);
  });
});
