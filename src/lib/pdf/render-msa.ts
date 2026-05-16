import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

// Source-of-truth MSA prose lives in this file. The render-quote.ts sibling
// uses the same convention: code over template files so the rendered output
// can be reproduced from the commit alone. `templateVersion` (stamped onto
// `master_service_agreements.templateVersion` at draft-create time) is the
// MSA_TEMPLATE_VERSION env value — bump it whenever this prose changes so
// each row carries which revision the signed PDF was rendered against.
//
// Clause numbering matches `docs/wiki/commercial-spine.md`'s §-citations:
// §1 (Services), §2 (Term + Termination), §3 (Payment), §5 (Cancellation),
// §9 (Governing Law). The legal team owns these clauses; structural changes
// here should be reviewed alongside any prose revision.

export type MsaPdfData = {
  /** Free-form short id printed in the header (e.g. "MSA-2026-0001"). */
  msaNumber: string;
  /** ISO date string of the draft issued date. */
  issuedDate: string;
  clientName: string;
  /** Multi-line; e.g. ["123 Main St", "Anywhere, ON  A1A 1A1"]. */
  clientAddress?: string[];
  /** Name of the Client signer (printed in the signature block). */
  signerName: string;
  signerEmail: string;
  /** ISO date string of the term start (typically the signature day). */
  termStart: string;
  /** ISO date string of the term end (typically termStart + 12 months). */
  termEnd: string;
  /** Days of written notice required for termination under §2.ii. */
  terminationNoticeDays: number;
  /** Province + country, e.g. "Nova Scotia, Canada" (§9). */
  governingLaw: string;
  /** Stamped into the footer for traceability — matches the DB column. */
  templateVersion: string;
};

// Signature-field anchor returned alongside the PDF body so the BoldSign
// envelope sender (`src/lib/boldsign/client.ts`) can pin a `FormField` of
// type Signature at the same on-page location the prose's right-column
// "For the Client" underline lives. Coordinates use BoldSign's coordinate
// system (top-left origin, page is 1-indexed) rather than pdf-lib's
// (bottom-left origin, page array 0-indexed) — the translation happens at
// capture time so consumers don't need to know about pdf-lib's convention.
export type SignatureAnchor = {
  /** 1-indexed page number (BoldSign convention). */
  pageNumber: number;
  /** Top-left origin, page units (points). */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RenderResult =
  | { ok: true; body: Buffer; signatureAnchor: SignatureAnchor }
  | { error: string };

// Sender block, sourced from salesability.ca/terms-conditions (mirrors
// render-quote.ts:41-48 — kept in sync by hand until either renderer pulls
// it from a shared module).
const SENDER = {
  name: 'Salesability Canada Inc.',
  address: [
    'Dartmouth, NS  B2W 6A1, Canada',
    '(902) 802-6215',
    'shannon@salesability.ca',
  ],
};

// WinAnsi-safe: pdf-lib's StandardFonts only encode the WinAnsi range
// (0x20-0xFF). Anything outside falls back to '?' to avoid runtime throw on
// names with non-Latin characters.
const WINANSI_RE = /[^ -ÿ]/g;
function sanitize(text: string): string {
  return text.replace(WINANSI_RE, '?');
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

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

type Section = { heading: string; paragraphs: string[] };

function buildSections(d: MsaPdfData): Section[] {
  return [
    {
      heading: '1. Services',
      paragraphs: [
        `This Master Service Agreement (the "Agreement") is entered into between Salesability Canada Inc. ("Salesability") and ${d.clientName} (the "Client").`,
        'i. Salesability shall provide sales-event services to the Client from time to time, as agreed upon by the Parties in one or more Quotes issued by Salesability and accepted by the Client during the term of this Agreement.',
        'ii. Each Quote shall describe the specific services to be provided, the fees payable, and any additional terms applicable to that engagement.',
        'iii. Each Quote issued by Salesability and accepted by the Client shall constitute a separate, distinct, and independent agreement and contractual obligation of the Parties hereto, incorporating by reference the terms and provisions of this Agreement.',
      ],
    },
    {
      heading: '2. Term and Termination',
      paragraphs: [
        `i. This Agreement shall commence on ${longDate(d.termStart)} and continue in full force and effect until ${longDate(d.termEnd)} (the "Term"), unless terminated earlier in accordance with §2.ii.`,
        `ii. Either Party may terminate this Agreement by providing not less than ${d.terminationNoticeDays} days' written notice to the other Party. Termination shall not affect the obligations of the Parties with respect to any Quote accepted prior to the effective date of termination.`,
        'iii. Upon expiration of the Term, this Agreement may be renewed by mutual written agreement of the Parties; any such renewal shall be evidenced by a new Master Service Agreement executed by both Parties.',
      ],
    },
    {
      heading: '3. Payment',
      paragraphs: [
        'i. The Client shall pay Salesability the fees set forth in each accepted Quote, including any deposit required at acceptance.',
        'ii. Invoices shall be issued upon completion of the services described in each accepted Quote and shall be payable in full upon receipt.',
        'iii. Late payments shall incur a monthly interest charge of 1.5% (18% annually) on the outstanding balance.',
      ],
    },
    {
      heading: '5. Cancellation',
      paragraphs: [
        'i. The Client may cancel an accepted Quote by providing written notice to Salesability.',
        'ii. If the Client cancels an accepted Quote within twenty-one (21) days prior to the start of the Event described in that Quote, the Client shall pay Salesability a cancellation fee equal to fifty percent (50%) of the total fee set forth in the cancelled Quote.',
      ],
    },
    {
      heading: '9. Governing Law',
      paragraphs: [
        `This Agreement shall be governed by, and construed in accordance with, the laws of ${d.governingLaw}, without regard to its conflict-of-law principles.`,
      ],
    },
  ];
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

export async function renderMsaPdf(data: MsaPdfData): Promise<RenderResult> {
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 50;
    const rightEdge = pageWidth - margin;
    const black = rgb(0, 0, 0);
    const grey = rgb(0.4, 0.4, 0.4);

    let page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Captured at the signature-block draw site below (`page.drawLine(...)`
    // for the right column's "For the Client" underline). Resolved to a
    // `pageNumber` post-save by `doc.getPages().indexOf(sigPage) + 1`.
    let sigPage: PDFPage | null = null;
    let sigBoxY: number | null = null;
    let sigBoxX: number | null = null;
    let sigBoxWidth: number | null = null;
    const SIG_BOX_HEIGHT = 22;

    // Header band on the first page only — mirrors render-quote.ts's layout
    // for visual consistency across the bundled envelope (MSA + Quote).
    const logoBytes = await readFile(
      path.join(process.cwd(), 'public', 'saledayevents-logo.jpg'),
    );
    const logo = await doc.embedJpg(logoBytes);
    const logoH = 50;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, {
      x: rightEdge - logoW,
      y: y - logoH,
      width: logoW,
      height: logoH,
    });

    const titleSize = 22;
    const titleAscent = bold.heightAtSize(titleSize, { descender: false });
    const titleBaseline = y - titleAscent;
    page.drawText('MASTER SERVICE AGREEMENT', {
      x: margin,
      y: titleBaseline,
      size: titleSize,
      font: bold,
      color: black,
    });
    let yLeft = titleBaseline - 18;
    page.drawText(sanitize(`Agreement #${data.msaNumber}`), {
      x: margin,
      y: yLeft,
      size: 11,
      font,
      color: grey,
    });
    yLeft -= 14;
    page.drawText(`Issued: ${longDate(data.issuedDate)}`, {
      x: margin,
      y: yLeft,
      size: 11,
      font,
      color: grey,
    });

    let yRight = y - logoH - 14;
    drawRight({ page, font: bold, size: 9, color: grey }, SENDER.name, rightEdge, yRight);
    yRight -= 11;
    for (const line of SENDER.address) {
      drawRight({ page, font, size: 9, color: grey }, line, rightEdge, yRight);
      yRight -= 11;
    }

    y = Math.min(yLeft, yRight) - 22;

    // Parties block. Client name + address printed under "Between" header.
    page.drawText('Between', { x: margin, y, size: 10, font: bold, color: black });
    y -= 14;
    page.drawText(sanitize(`${SENDER.name} ("Salesability")`), {
      x: margin,
      y,
      size: 11,
      font,
      color: black,
    });
    y -= 14;
    page.drawText(sanitize(`${data.clientName} (the "Client")`), {
      x: margin,
      y,
      size: 11,
      font,
      color: black,
    });
    y -= 14;
    if (data.clientAddress) {
      for (const line of data.clientAddress) {
        page.drawText(sanitize(line), { x: margin, y, size: 10, font, color: grey });
        y -= 12;
      }
    }
    y -= 16;

    // Body: each Section block. Add a new page when y would drop below the
    // bottom margin; reset y to the top of the new page (no header band on
    // continuation pages, matching standard contract layout conventions).
    const ensureSpace = (linesNeeded: number, lineHeight: number) => {
      if (y - linesNeeded * lineHeight < margin + 40) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
    };

    const sections = buildSections(data);
    for (const section of sections) {
      ensureSpace(2, 14);
      page.drawText(section.heading, {
        x: margin,
        y,
        size: 11,
        font: bold,
        color: black,
      });
      y -= 16;
      for (const para of section.paragraphs) {
        const lines = wrap(sanitize(para), 95);
        ensureSpace(lines.length + 1, 12);
        for (const line of lines) {
          page.drawText(line, { x: margin, y, size: 9, font, color: black });
          y -= 12;
        }
        y -= 4;
      }
      y -= 8;
    }

    // Signature block — needs at least ~120pt at the bottom of a page,
    // otherwise paginate to a fresh page for it.
    if (y < margin + 120) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawLine({
      start: { x: margin, y: y - 4 },
      end: { x: rightEdge, y: y - 4 },
      thickness: 0.5,
      color: grey,
    });
    y -= 24;
    page.drawText('Signatures', { x: margin, y, size: 11, font: bold, color: black });
    y -= 22;

    const colWidth = (rightEdge - margin - 30) / 2;
    const leftColX = margin;
    const rightColX = margin + colWidth + 30;
    page.drawText('For Salesability:', { x: leftColX, y, size: 10, font: bold, color: black });
    page.drawText('For the Client:', { x: rightColX, y, size: 10, font: bold, color: black });
    y -= 36;
    page.drawLine({
      start: { x: leftColX, y },
      end: { x: leftColX + colWidth, y },
      thickness: 0.5,
      color: black,
    });
    page.drawLine({
      start: { x: rightColX, y },
      end: { x: rightColX + colWidth, y },
      thickness: 0.5,
      color: black,
    });
    // Capture the BoldSign signature-field anchor. The visual underline sits
    // at pdf-lib y (bottom-left origin); BoldSign expects a top-left-origin
    // bounding box. The signer draws *into* the box with the underline as
    // its visual baseline, so the box sits above the line in pdf-lib coords
    // (y .. y + SIG_BOX_HEIGHT) — equivalently in BoldSign top-left coords
    // its top edge is `pageHeight - (y + SIG_BOX_HEIGHT)`.
    sigPage = page;
    sigBoxX = rightColX;
    sigBoxY = pageHeight - (y + SIG_BOX_HEIGHT);
    sigBoxWidth = colWidth;
    y -= 12;
    page.drawText(sanitize('Shannon Hogan, President'), {
      x: leftColX,
      y,
      size: 9,
      font,
      color: grey,
    });
    page.drawText(sanitize(data.signerName), { x: rightColX, y, size: 9, font, color: grey });
    y -= 11;
    page.drawText('shannon@salesability.ca', { x: leftColX, y, size: 9, font, color: grey });
    page.drawText(sanitize(data.signerEmail), { x: rightColX, y, size: 9, font, color: grey });

    // Footer: template version on the last page only. Helps support requests
    // by making "what prose did they sign?" visible without consulting the DB.
    page.drawText(sanitize(`Template version: ${data.templateVersion}`), {
      x: margin,
      y: margin - 20,
      size: 7,
      font,
      color: grey,
    });

    if (sigPage == null || sigBoxX == null || sigBoxY == null || sigBoxWidth == null) {
      // Should be unreachable — the signature block is unconditional in the
      // render flow. Fail loud if a future refactor accidentally skips it,
      // rather than ship a fieldless envelope that BoldSign would reject
      // with the exact 400 this anchor was added to prevent.
      return { error: 'renderMsaPdf failed: signature anchor was not captured.' };
    }
    const pageIndex = doc.getPages().indexOf(sigPage);
    if (pageIndex < 0) {
      return { error: 'renderMsaPdf failed: signature page is not in the document.' };
    }
    const signatureAnchor: SignatureAnchor = {
      pageNumber: pageIndex + 1,
      x: sigBoxX,
      y: sigBoxY,
      width: sigBoxWidth,
      height: SIG_BOX_HEIGHT,
    };

    const bytes = await doc.save();
    return { ok: true, body: Buffer.from(bytes), signatureAnchor };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'renderMsaPdf failed.',
    };
  }
}
