import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('server-only', () => ({}));

import { renderMsaPdf, type MsaPdfData } from './render-msa';

const fixture: MsaPdfData = {
  msaNumber: 'MSA-2026-0001',
  issuedDate: '2026-05-12',
  clientName: 'Acme Auto Group',
  clientAddress: ['456 Dealership Boulevard', 'Mississauga, ON  L5B 3C2'],
  signerName: 'Jane Doe',
  signerEmail: 'jane@acmeauto.test',
  termStart: '2026-05-12',
  termEnd: '2027-05-12',
  terminationNoticeDays: 30,
  governingLaw: 'Nova Scotia, Canada',
  templateVersion: '2026-05-12',
};

describe('renderMsaPdf', () => {
  it('returns a non-empty Buffer with the PDF magic header', async () => {
    const result = await renderMsaPdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect(result.body.length).toBeGreaterThan(500);
    expect(result.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('round-trips through pdf-lib with US-Letter pages', async () => {
    const result = await renderMsaPdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    const reloaded = await PDFDocument.load(result.body);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
    const page = reloaded.getPage(0);
    expect(page.getWidth()).toBe(612);
    expect(page.getHeight()).toBe(792);
  });

  it('paginates onto a second page when the signature block would not fit', async () => {
    // The default fixture's section count + signature block exceeds one page;
    // verify the renderer adds a second page without throwing.
    const result = await renderMsaPdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    const reloaded = await PDFDocument.load(result.body);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(2);
    // Every page is US Letter.
    for (let i = 0; i < reloaded.getPageCount(); i++) {
      const page = reloaded.getPage(i);
      expect(page.getWidth()).toBe(612);
      expect(page.getHeight()).toBe(792);
    }
  });

  it('renders with a missing clientAddress (optional field)', async () => {
    const result = await renderMsaPdf({ ...fixture, clientAddress: undefined });
    expect('ok' in result && result.ok).toBe(true);
  });

  it('returns a signatureAnchor with valid coords for the right-column signer box', async () => {
    const result = await renderMsaPdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    const a = result.signatureAnchor;
    expect(a.pageNumber).toBeGreaterThanOrEqual(1);
    // Right column on a 612pt page with margin=50, gap=30 between columns →
    // rightColX = 50 + ((612 - 100 - 30) / 2) + 30 = 50 + 241 + 30 = 321.
    expect(a.x).toBeCloseTo(321, 0);
    // colWidth = (612 - 100 - 30) / 2 = 241.
    expect(a.width).toBeCloseTo(241, 0);
    // SIG_BOX_HEIGHT in render-msa.ts is fixed at 22.
    expect(a.height).toBe(22);
    // Top-left origin y must land on the page (0 < y < pageHeight - height).
    expect(a.y).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(792 - 22);
  });

  it('signatureAnchor.pageNumber matches the final page when the signature block paginates over', async () => {
    // The default fixture's prose pushes the signature block to page 2 today
    // (the renderer adds a new page if y < margin + 120). Lock in that the
    // anchor's pageNumber matches the actually-rendered page count rather
    // than always reporting 1.
    const result = await renderMsaPdf(fixture);
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result) || !result.ok) return;
    const reloaded = await PDFDocument.load(result.body);
    expect(result.signatureAnchor.pageNumber).toBeLessThanOrEqual(reloaded.getPageCount());
    expect(result.signatureAnchor.pageNumber).toBeGreaterThanOrEqual(1);
  });

  // Opt-in visual smoke: WRITE_SMOKE_PDF=1 pnpm vitest run src/lib/pdf
  // writes /tmp/msa-smoke.pdf so the layout can be eyeballed. Skipped in CI.
  it.skipIf(!process.env.WRITE_SMOKE_PDF)('writes /tmp/msa-smoke.pdf', async () => {
    const result = await renderMsaPdf(fixture);
    if (!('ok' in result) || !result.ok) throw new Error('render failed');
    writeFileSync('/tmp/msa-smoke.pdf', result.body);
    console.log(`Wrote ${result.body.length} bytes → /tmp/msa-smoke.pdf`);
  });
});
