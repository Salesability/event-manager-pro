import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

export type QuoteLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type QuoteData = {
  quoteNumber: string;
  issuedDate: string;
  /** ISO `YYYY-MM-DD` derived from `sentAt + quoteValidDays` (or today + quoteValidDays for unsent drafts). */
  validUntilDate: string;
  clientName: string;
  clientAddress?: string[]; // multi-line; e.g. ["123 Main St", "Anywhere, ON  A1A 1A1"]
  eventName: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  tax: number;
  total: number;
};

export type RenderResult = { ok: true; body: Buffer } | { error: string };

// Hard cap on line-item count for the single-page layout. The current y-axis
// math leaves the lowest text above the 50pt bottom margin at 12 items for
// the fixture-size Bill To block used by the composer. The "Valid until"
// line added in 0044 consumed ~14pt of vertical space in the header band,
// dropping the cap from 13 to 12.
export const MAX_LINE_ITEMS = 12;

// Quote document is built programmatically with pdf-lib — code is the source
// of truth for layout (logo, fonts, margins, text). Rendered output persists
// to GCS at `quotes/{quoteId}/{revision}.pdf`; templates are not stored.

// Sender block, sourced from salesability.ca/terms-conditions (2026-05-08).
// If a street address is added to the public listing, fold it in here as a
// new first address line. Email is currently the public personal alias from
// the website — swap for a generic (e.g. quotes@salesability.ca) once one
// exists.
const SENDER = {
  name: 'Salesability Canada Inc.',
  address: [
    'Dartmouth, NS  B2W 6A1, Canada',
    '(902) 802-6215',
    'shannon@salesability.ca',
  ],
};

const TERMS_AND_CONDITIONS =
  'By accepting this Quote, the Client understands and agrees that this Quote ' +
  'incorporates the terms and provisions of the Master Agreement as if those ' +
  'terms and provisions were contained herein. The Client further understands ' +
  'and agrees that the terms and provisions of the Master Agreement form an ' +
  'integral and binding part of this Quote.';

const INVOICING_AND_PAYMENT =
  'Salesability shall issue an invoice to the Client for the Services upon ' +
  'completion of the Event. The Client must pay the invoice in full upon ' +
  'receipt. Late payments will incur a monthly interest charge of 1.5% (18% ' +
  'annually).';

const cadFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
});

const WINANSI_RE = /[^ -ÿ]/g;

function sanitizeWinAnsi(text: string): string {
  return text.replace(WINANSI_RE, '?');
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const sanitized = sanitizeWinAnsi(text);
  if (font.widthOfTextAtSize(sanitized, size) <= maxWidth) return sanitized;
  const suffix = '...';
  const suffixWidth = font.widthOfTextAtSize(suffix, size);
  if (suffixWidth >= maxWidth) return '';

  let out = sanitized;
  while (out.length && font.widthOfTextAtSize(out, size) + suffixWidth > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}${suffix}`;
}

function formatCurrency(n: number): string {
  return cadFormatter.format(n);
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) {
      line = w;
    } else if (line.length + 1 + w.length <= maxChars) {
      line += ` ${w}`;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type DrawOpts = {
  page: PDFPage;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
};

function drawRight(opts: DrawOpts, text: string, rightX: number, y: number) {
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  opts.page.drawText(text, {
    x: rightX - w,
    y,
    size: opts.size,
    font: opts.font,
    color: opts.color,
  });
}

export async function renderQuotePdf(quote: QuoteData): Promise<RenderResult> {
  try {
    if (quote.lineItems.length > MAX_LINE_ITEMS) {
      return {
        error: `Quote has ${quote.lineItems.length} line items; max ${MAX_LINE_ITEMS} fit on a single page.`,
      };
    }
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // US Letter
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const margin = 50;
    const rightEdge = 612 - margin;
    const contentWidth = rightEdge - margin;
    const black = rgb(0, 0, 0);
    const grey = rgb(0.4, 0.4, 0.4);
    const yTop = 792 - margin;

    // --- Header band. Logo + QUOTE title both have their VISUAL TOPS aligned
    // to the top margin (yTop). pdf-lib draws text by baseline, so we offset
    // the title baseline down by its cap-height. Logo (image) is positioned
    // by its bottom-left corner so we set y = yTop - logoH.
    // The "Issued" + sender stack is the RIGHT column under the logo; the
    // Quote # is the LEFT column under the title. Columns are independent
    // until the Bill To row, where they merge.
    const logoBytes = await readFile(
      path.join(process.cwd(), 'public', 'saledayevents-logo.jpg'),
    );
    const logo = await doc.embedJpg(logoBytes);
    const logoH = 50;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, {
      x: rightEdge - logoW,
      y: yTop - logoH,
      width: logoW,
      height: logoH,
    });

    // Left column. Baseline lowered so QUOTE's cap top sits at yTop.
    const titleSize = 24;
    const titleAscent = bold.heightAtSize(titleSize, { descender: false });
    const titleBaseline = yTop - titleAscent;
    page.drawText('QUOTE', {
      x: margin,
      y: titleBaseline,
      size: titleSize,
      font: bold,
      color: black,
    });
    const yLeft = titleBaseline - 18;
    page.drawText(`Quote #${quote.quoteNumber}`, {
      x: margin,
      y: yLeft,
      size: 11,
      font,
      color: grey,
    });

    // Right column — starts below the logo's bottom edge.
    let yRight = yTop - logoH - 14;
    drawRight(
      { page, font, size: 11, color: grey },
      `Issued: ${quote.issuedDate}`,
      rightEdge,
      yRight,
    );
    yRight -= 14;
    drawRight(
      { page, font, size: 11, color: grey },
      `Valid until: ${quote.validUntilDate}`,
      rightEdge,
      yRight,
    );
    yRight -= 16;
    drawRight({ page, font: bold, size: 9, color: grey }, SENDER.name, rightEdge, yRight);
    yRight -= 11;
    for (const line of SENDER.address) {
      drawRight({ page, font, size: 9, color: grey }, line, rightEdge, yRight);
      yRight -= 11;
    }

    // Merge: continue from whichever column ended lower on the page.
    let y = Math.min(yLeft, yRight) - 18;

    // --- Bill To block. Stacked under the QUOTE meta on the left.
    page.drawText('Bill To', { x: margin, y, size: 10, font: bold, color: black });
    y -= 14;
    page.drawText(truncateToWidth(quote.clientName, font, 11, contentWidth), {
      x: margin,
      y,
      size: 11,
      font,
      color: black,
    });
    y -= 14;
    if (quote.clientAddress) {
      for (const line of quote.clientAddress) {
        page.drawText(truncateToWidth(line, font, 10, contentWidth), {
          x: margin,
          y,
          size: 10,
          font,
          color: grey,
        });
        y -= 12;
      }
    }
    y -= 6;
    page.drawText('Event', { x: margin, y, size: 10, font: bold, color: black });
    y -= 14;
    page.drawText(quote.eventName, { x: margin, y, size: 11, font, color: black });
    y -= 28;

    page.drawLine({
      start: { x: margin, y },
      end: { x: rightEdge, y },
      thickness: 0.5,
      color: grey,
    });
    y -= 18;

    // --- Line-items table. Numerics right-aligned to their column's right edge.
    const colDescX = margin;
    const colQtyR = 380;
    const colUnitR = 470;
    const colTotalR = rightEdge;
    page.drawText('Description', { x: colDescX, y, size: 10, font: bold, color: black });
    drawRight({ page, font: bold, size: 10, color: black }, 'Qty', colQtyR, y);
    drawRight({ page, font: bold, size: 10, color: black }, 'Unit', colUnitR, y);
    drawRight({ page, font: bold, size: 10, color: black }, 'Total', colTotalR, y);
    y -= 14;
    page.drawLine({
      start: { x: margin, y: y + 4 },
      end: { x: rightEdge, y: y + 4 },
      thickness: 0.25,
      color: grey,
    });
    y -= 8;

    for (const item of quote.lineItems) {
      page.drawText(item.description, { x: colDescX, y, size: 10, font, color: black });
      drawRight({ page, font, size: 10, color: black }, String(item.quantity), colQtyR, y);
      drawRight(
        { page, font, size: 10, color: black },
        formatCurrency(item.unitPrice),
        colUnitR,
        y,
      );
      drawRight({ page, font, size: 10, color: black }, formatCurrency(item.total), colTotalR, y);
      y -= 16;
    }

    y -= 8;
    page.drawLine({
      start: { x: colUnitR - 50, y },
      end: { x: rightEdge, y },
      thickness: 0.25,
      color: grey,
    });
    y -= 16;
    const totalsLabelR = colTotalR - 80;
    drawRight({ page, font, size: 10, color: black }, 'Subtotal', totalsLabelR, y);
    drawRight(
      { page, font, size: 10, color: black },
      formatCurrency(quote.subtotal),
      colTotalR,
      y,
    );
    y -= 14;
    drawRight({ page, font, size: 10, color: black }, 'Tax', totalsLabelR, y);
    drawRight({ page, font, size: 10, color: black }, formatCurrency(quote.tax), colTotalR, y);
    y -= 14;
    drawRight({ page, font: bold, size: 11, color: black }, 'Total', totalsLabelR, y);
    drawRight(
      { page, font: bold, size: 11, color: black },
      formatCurrency(quote.total),
      colTotalR,
      y,
    );
    y -= 36;

    // --- Terms.
    page.drawText('Terms and Conditions', {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: black,
    });
    y -= 14;
    for (const line of wrap(TERMS_AND_CONDITIONS, 95)) {
      page.drawText(line, { x: margin, y, size: 9, font, color: black });
      y -= 12;
    }
    y -= 8;
    page.drawText('Invoicing & Payment', {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: black,
    });
    y -= 14;
    for (const line of wrap(INVOICING_AND_PAYMENT, 95)) {
      page.drawText(line, { x: margin, y, size: 9, font, color: black });
      y -= 12;
    }

    const bytes = await doc.save();
    return { ok: true, body: Buffer.from(bytes) };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'renderQuotePdf failed.',
    };
  }
}
