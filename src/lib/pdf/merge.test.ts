import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('server-only', () => ({}));

import { combineQuoteAndMsa } from './merge';
import type { SignatureAnchor } from './render-msa';

// Build a throwaway US-Letter PDF with `n` pages for deterministic page-math.
async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

const anchor = (pageNumber: number): SignatureAnchor => ({
  pageNumber,
  x: 321,
  y: 200,
  width: 241,
  height: 22,
});

describe('combineQuoteAndMsa', () => {
  it('concatenates Quote then MSA and shifts the anchor by the Quote page count', async () => {
    const quote = await makePdf(2);
    const msa = await makePdf(3);

    const result = await combineQuoteAndMsa(quote, {
      body: msa,
      signatureAnchor: anchor(2), // page 2 of the 3-page MSA
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;

    const reloaded = await PDFDocument.load(result.body);
    expect(reloaded.getPageCount()).toBe(5); // 2 quote + 3 msa

    // anchor was page 2 within the MSA → after 2 quote pages, page 4 overall
    expect(result.signatureAnchor.pageNumber).toBe(4);
    // geometry is unchanged (same US-Letter page)
    expect(result.signatureAnchor.x).toBe(321);
    expect(result.signatureAnchor.y).toBe(200);
    expect(result.signatureAnchor.width).toBe(241);
    expect(result.signatureAnchor.height).toBe(22);
  });

  it('handles a single-page quote + single-page msa', async () => {
    const result = await combineQuoteAndMsa(await makePdf(1), {
      body: await makePdf(1),
      signatureAnchor: anchor(1),
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    expect((await PDFDocument.load(result.body)).getPageCount()).toBe(2);
    expect(result.signatureAnchor.pageNumber).toBe(2); // 1 quote + page 1 of msa
  });

  it('returns the magic %PDF header on success', async () => {
    const result = await combineQuoteAndMsa(await makePdf(1), {
      body: await makePdf(1),
      signatureAnchor: anchor(1),
    });
    if (!('ok' in result) || !result.ok) throw new Error('expected ok');
    expect(result.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns an error (not a throw) when given non-PDF bytes', async () => {
    const result = await combineQuoteAndMsa(Buffer.from('not a pdf'), {
      body: await makePdf(1),
      signatureAnchor: anchor(1),
    });
    expect('error' in result).toBe(true);
  });
});
