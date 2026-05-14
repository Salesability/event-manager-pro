import { describe, expect, it } from 'vitest';
import { quoteDisplayName, quoteDownloadFilename } from './display-name';

describe('quoteDisplayName', () => {
  it('renders an EDT instant as quote-YYYYMMDD-HHmm in America/Toronto', () => {
    // 2026-05-14 18:30:00 UTC = 14:30 EDT (UTC-4)
    expect(quoteDisplayName(new Date('2026-05-14T18:30:00Z'))).toBe('quote-20260514-1430');
  });

  it('renders an EST instant in America/Toronto (UTC-5 in winter)', () => {
    // 2026-01-15 13:00:00 UTC = 08:00 EST
    expect(quoteDisplayName(new Date('2026-01-15T13:00:00Z'))).toBe('quote-20260115-0800');
  });

  it('zero-pads hours and minutes', () => {
    // 2026-05-14 04:05:00 UTC = 00:05 EDT
    expect(quoteDisplayName(new Date('2026-05-14T04:05:00Z'))).toBe('quote-20260514-0005');
  });

  it('handles DST-boundary instants without throwing', () => {
    // 2026-03-08 06:59:59 UTC is just before EST→EDT spring-forward (01:59 EST)
    expect(quoteDisplayName(new Date('2026-03-08T06:59:59Z'))).toBe('quote-20260308-0159');
    // 2026-03-08 07:00:00 UTC is just after spring-forward (03:00 EDT)
    expect(quoteDisplayName(new Date('2026-03-08T07:00:00Z'))).toBe('quote-20260308-0300');
  });
});

describe('quoteDownloadFilename', () => {
  it('wraps quoteDisplayName with saledayevents- prefix and .pdf suffix', () => {
    expect(quoteDownloadFilename(new Date('2026-05-14T18:30:00Z'))).toBe(
      'saledayevents-quote-20260514-1430.pdf',
    );
  });
});
