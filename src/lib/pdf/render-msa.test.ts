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

  // Opt-in visual smoke: WRITE_SMOKE_PDF=1 pnpm vitest run src/lib/pdf
  // writes /tmp/msa-smoke.pdf so the layout can be eyeballed. Skipped in CI.
  it.skipIf(!process.env.WRITE_SMOKE_PDF)('writes /tmp/msa-smoke.pdf', async () => {
    const result = await renderMsaPdf(fixture);
    if (!('ok' in result) || !result.ok) throw new Error('render failed');
    writeFileSync('/tmp/msa-smoke.pdf', result.body);
    console.log(`Wrote ${result.body.length} bytes → /tmp/msa-smoke.pdf`);
  });
});
