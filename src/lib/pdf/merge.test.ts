import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('server-only', () => ({}));

import { combineQuoteAndMsa } from './merge';
import type { FieldAnchor } from './anchors';

// Build a throwaway US-Letter PDF with `n` pages for deterministic page-math.
async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

const anchor = (pageNumber: number): FieldAnchor => ({
  pageNumber,
  x: 321,
  y: 200,
  width: 241,
  height: 22,
});

describe('combineQuoteAndMsa', () => {
  it('concatenates Quote then MSA and shifts the signature anchor by the Quote page count', async () => {
    const quote = await makePdf(2);
    const msa = await makePdf(3);

    const result = await combineQuoteAndMsa(
      { body: quote },
      { body: msa, signatureAnchor: anchor(2) }, // page 2 of the 3-page MSA
    );
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

  it('carries the Quote initials anchor through with its page number unchanged', async () => {
    const result = await combineQuoteAndMsa(
      { body: await makePdf(1), initialsAnchor: { ...anchor(1), x: 492, width: 70 } },
      { body: await makePdf(2), signatureAnchor: anchor(2) },
    );
    if (!('ok' in result) || !result.ok) throw new Error('expected ok');
    expect(result.initialsAnchors).toHaveLength(1);
    // quote is first → its initials anchor keeps page 1
    expect(result.initialsAnchors[0].pageNumber).toBe(1);
    expect(result.initialsAnchors[0].x).toBe(492);
    // signature anchor (page 2 of MSA) shifts past the single quote page → 3
    expect(result.signatureAnchor.pageNumber).toBe(3);
  });

  it('returns an empty initials list when the quote has no initials anchor', async () => {
    const result = await combineQuoteAndMsa(
      { body: await makePdf(1) },
      { body: await makePdf(1), signatureAnchor: anchor(1) },
    );
    if (!('ok' in result) || !result.ok) throw new Error('expected ok');
    expect(result.initialsAnchors).toEqual([]);
    expect(result.signatureAnchor.pageNumber).toBe(2);
    expect(result.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns an error (not a throw) when given non-PDF bytes', async () => {
    const result = await combineQuoteAndMsa(
      { body: Buffer.from('not a pdf') },
      { body: await makePdf(1), signatureAnchor: anchor(1) },
    );
    expect('error' in result).toBe(true);
  });
});
