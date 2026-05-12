import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage } from 'pdf-lib';

vi.mock('server-only', () => ({}));

import { MAX_LINE_ITEMS, renderQuotePdf, type QuoteData, type QuoteLineItem } from './render-quote';

const fixture: QuoteData = {
  quoteNumber: 'Q-2026-0001',
  issuedDate: '2026-05-08',
  clientName: 'Acme Auto Group',
  clientAddress: ['456 Dealership Boulevard', 'Mississauga, ON  L5B 3C2'],
  eventName: 'Spring Tent Sale 2026',
  lineItems: [
    { description: 'Tent rental (40x60)', quantity: 1, unitPrice: 2400, total: 2400 },
    { description: 'On-site coach (3 days)', quantity: 3, unitPrice: 750, total: 2250 },
    { description: 'Marketing collateral', quantity: 1, unitPrice: 350, total: 350 },
  ],
  subtotal: 5000,
  tax: 650,
  total: 5650,
};

describe('renderQuotePdf', () => {
  it('returns a non-empty Buffer with the PDF magic header', async () => {
    const result = await renderQuotePdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect(result.body.length).toBeGreaterThan(500);
    expect(result.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders even with zero line items (empty quote)', async () => {
    const result = await renderQuotePdf({ ...fixture, lineItems: [], subtotal: 0, tax: 0, total: 0 });
    expect('ok' in result && result.ok).toBe(true);
  });

  it('round-trips through pdf-lib as a single US-Letter page', async () => {
    const result = await renderQuotePdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    const reloaded = await PDFDocument.load(result.body);
    expect(reloaded.getPageCount()).toBe(1);
    const page = reloaded.getPage(0);
    expect(page.getWidth()).toBe(612);
    expect(page.getHeight()).toBe(792);
  });

  it('renders MAX_LINE_ITEMS lines on a single page', async () => {
    const drawnY: number[] = [];
    const originalDrawText = PDFPage.prototype.drawText;
    const drawTextSpy = vi
      .spyOn(PDFPage.prototype, 'drawText')
      .mockImplementation(function (
        this: PDFPage,
        text: string,
        options?: Parameters<PDFPage['drawText']>[1],
      ) {
        if (typeof options?.y === 'number') drawnY.push(options.y);
        return originalDrawText.call(this, text, options);
      });
    const many: QuoteLineItem[] = Array.from({ length: MAX_LINE_ITEMS }, (_, i) => ({
      description: `Line item ${i + 1}`,
      quantity: 1,
      unitPrice: 10,
      total: 10,
    }));
    const result = await renderQuotePdf({
      ...fixture,
      lineItems: many,
      subtotal: MAX_LINE_ITEMS * 10,
      tax: 0,
      total: MAX_LINE_ITEMS * 10,
    });
    drawTextSpy.mockRestore();
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    const reloaded = await PDFDocument.load(result.body);
    expect(reloaded.getPageCount()).toBe(1);
    expect(Math.min(...drawnY)).toBeGreaterThanOrEqual(50);
  });

  it('refuses to render more than MAX_LINE_ITEMS line items', async () => {
    const tooMany: QuoteLineItem[] = Array.from({ length: MAX_LINE_ITEMS + 1 }, (_, i) => ({
      description: `Line item ${i + 1}`,
      quantity: 1,
      unitPrice: 10,
      total: 10,
    }));
    const result = await renderQuotePdf({ ...fixture, lineItems: tooMany });
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain(String(MAX_LINE_ITEMS));
  });

  // Opt-in visual smoke: WRITE_SMOKE_PDF=1 pnpm vitest run src/lib/pdf
  // writes /tmp/quote-smoke.pdf so the layout can be eyeballed. Skipped in CI.
  it.skipIf(!process.env.WRITE_SMOKE_PDF)('writes /tmp/quote-smoke.pdf', async () => {
    const result = await renderQuotePdf(fixture);
    if (!('ok' in result) || !result.ok) throw new Error('render failed');
    writeFileSync('/tmp/quote-smoke.pdf', result.body);
    console.log(`Wrote ${result.body.length} bytes → /tmp/quote-smoke.pdf`);
  });
});
