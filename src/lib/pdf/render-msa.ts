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
// `buildSections` is a VERBATIM transcription of the lawyer's "MASTER SERVICES
// AGREEMENT - March 25, 2026" (10 articles: §1 Services, §2 Term & Termination,
// §3 Fees & Payment, §4 Liability & Indemnity, §5 Intellectual Property, §6
// Personal Information / PIPEDA / CASL, §7 Confidentiality, §8 Independent
// Contractor, §9 Governing Law, §10 General Provisions). The cancellation fee
// is §2(iii); the late-payment charge is §3(iv) — `docs/wiki/commercial-spine.md`
// §-citations track these. The legal team owns this text; do not paraphrase —
// any edit must come from a revised source document, and bump
// MSA_TEMPLATE_VERSION when it does.

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

// Verbatim transcription of the lawyer's "MASTER SERVICES AGREEMENT - March
// 25, 2026". The only interpolation is §2(ii)'s notice period, which the source
// leaves blank ("XX days"); the caller passes `terminationNoticeDays` (30).
// Article titles use the source's uppercase; sub-clauses use lowercase roman
// numerals to match the source's internal cross-references (e.g. "section
// 2(iii)"). Single unlabeled articles (§5, §7, §8, §9) render as one paragraph.
function buildSections(d: MsaPdfData): Section[] {
  return [
    {
      heading: '1. SERVICES',
      paragraphs: [
        'i. Services. The Client hereby retains Salesability to provide the Client with marketing and event services, as more particularly described in Quotes issued by Salesability and accepted by the Client from time to time (the "Services").',
        'ii. Master Agreement. This Agreement is a master agreement that contemplates that Salesability and the Client may enter into one or more Quotes for the provision of Services as set out therein. When Salesability and the Client have agreed upon the nature and timing of a project for the provision of Services, Salesability shall issue a corresponding Quote and the Client shall accept the Quote, and that Quote shall contain the agreement of the Parties in relation to the specific project.',
        'iii. Quote. Each Quote issued by Salesability and accepted by the Client is deemed to include all the terms and provisions of this Agreement. Each Quote issued by Salesability and accepted by the Client shall constitute a separate distinct and independent agreement and contractual obligation of the Parties hereto.',
        'iv. Precedence. In the event of a conflict between the provisions of this Agreement and the provisions of a Quote issued by Salesability and accepted by the Client, the following shall be the order of precedence: (i) the applicable Quote for the provision of the Services; and (ii) this Agreement; provided that whenever the provisions of a Quote conflict with the provisions of this Agreement, the provisions of such Quote take precedence over the provisions of this Agreement only for the purposes of that Quote and the terms and provisions of this Agreement are not otherwise amended, modified, cancelled, waived or released.',
        'v. Cooperation of Client. The Client agrees to provide all necessary information to Salesability in a timely manner for the proper execution of the Services.',
        "vi. Sub-contractors. The Client acknowledges and agrees that Salesability may use subcontractors to perform some of the Services to be provided under this Agreement. The sub-contractors are solely responsible for their conduct while at the Client's premises.",
      ],
    },
    {
      heading: '2. TERM & TERMINATION',
      paragraphs: [
        'i. Term. The term of this Agreement begins on the date that this Agreement is signed by the Client and shall continue for a period of twelve (12) months thereafter, unless the Agreement is terminated earlier in accordance with the provisions of this Agreement.',
        `ii. Termination on Notice. Subject to section 2(iii) below, either Party may terminate this Agreement by providing the other party with ${d.terminationNoticeDays} days' advance written notice.`,
        'iii. Cancellation Fee. If the Client terminates this Agreement within 21 days before the start date of an Event set out in a Quote that has been accepted by the Client, then the Client agrees to pay a cancellation fee equal to 50% of the total agreed upon fees set out in the applicable Quote, (the "Cancellation Fee").',
        'iv. Termination for Non-Payment. Salesability reserves the right to cease Services if the Client does not make payments in accordance with this Agreement.',
      ],
    },
    {
      heading: '3. FEES & PAYMENT',
      paragraphs: [
        'i. Fees. The Client shall pay Salesability fees for the Services in the amounts set out in the applicable Quote.',
        'ii. Invoices. Salesability shall prepare and submit invoice(s) to the Client.',
        'iii. Payment. The Client must pay invoices in full upon receipt, unless otherwise specified in writing by Salesability.',
        'iv. Late Payment. Late payments will incur a monthly interest charge of 1.5% (18% annually).',
      ],
    },
    {
      heading: '4. LIABILITY & INDEMNITY',
      paragraphs: [
        "i. Limitation of Liability. Salesability's entire aggregate liability for any claims relating to the Services or this Agreement shall not exceed the fees paid or payable by the Client to Salesability under this Agreement in the twelve (12) month period immediately preceding the events giving rise to such liability. In no event shall Salesability be liable under this Agreement to the Client for any incidental, consequential, indirect, statutory, special, exemplary or punitive damages, including, but not limited to, lost profits, loss of use, loss of time, inconvenience, lost business opportunities, damage to goodwill or reputation, and costs of cover, regardless of whether such liability is based on breach of contract, tort, strict liability or otherwise, and even if advised of the possibility of such damages or such damages could have been reasonably foreseen. Salesability outsources production and software services to third parties, including Vicimus Inc., who maintain their own terms of service and liabilities. The Client acknowledges and agrees that Salesability is not liable for any third-party service provider's actions or omissions. Salesability and the Client acknowledge and agree that the limitations of liability in this section present a fair allocation of risk and liability, and that this section is an essential part of the bargain between the Client and Salesability and a controlling factor in setting any fees or other charges.",
        "ii. General Indemnity. The Client shall indemnify, defend and hold harmless Salesability from and against any and all losses, damages, costs, expenses (including legal fees), claims, complaints, demands, actions, suits, proceedings, obligations and liabilities (including settlement payments) arising from, connected with or relating to the Client's use of the Services, a breach of this Agreement by the Client or its employees, and/or any negligent act or omission by the Client or its employees in relation to this Agreement.",
        'iii. Survival. This article shall survive the termination of this Agreement.',
      ],
    },
    {
      heading: '5. INTELLECTUAL PROPERTY',
      paragraphs: [
        "All intellectual property created by Salesability remains the exclusive property of Salesability unless otherwise agreed by the Parties in writing. The Client hereby grants Salesability a non-exclusive, royalty-free, transferable (to Salesability's subcontractors) license to use the Client's branding, logos, and other intellectual property strictly for the purposes of delivering the Services.",
      ],
    },
    {
      heading: '6. PERSONAL INFORMATION, DATA PROTECTION & COMPLIANCE',
      paragraphs: [
        'i. Compliance. Salesability and the Client agree to comply with all applicable Canadian privacy laws, including the Personal Information Protection and Electronic Documents Act ("PIPEDA") in the performance of this Agreement. Salesability shall not be liable for any non-compliance of PIPEDA by the Client. Salesability follows Canada\'s anti-spam legislation ("CASL") requirements regarding electronic communications. Salesability shall not be liable for any non-compliance of CASL by the Client.',
        'ii. Legal Authorizations and Consents. The Client shall be solely responsible and liable for lawfully obtaining from its customers all legal authorizations and/or consents required pursuant to PIPEDA and CASL to provide the personal information of its customers to Salesability in order for Salesability to perform the Services, including but not limited to: (a) allowing Salesability to collect, use and disclose that information; and (b) allowing Salesability to contact the Client\'s customers by electronic communications for marketing purposes, (the "Purpose").',
        'iii. Warranty. The Client hereby represents and warrants to Salesability that the Client has lawfully obtained from its customers all legal authorizations and/or consents required pursuant to PIPEDA and CASL to provide the personal information of its customers to Salesability in order for Salesability to carry out the Purpose. The Client acknowledges and understands that Salesability is relying upon all such representations and warranties made by the Client in entering into this Agreement.',
        'iv. Warranty Indemnity. The Client shall indemnify, defend and hold harmless Salesability from and against any claims, liabilities, demands, actions, losses, damages, fines, penalties or expenses of any kind arising out of or in connection with any failure by the Client to obtain the required legal authorizations and/or consents warranted by the Client in this Agreement.',
        'v. Data Security. Salesability will handle any personal information provided by the Client in a secure and responsible manner.',
      ],
    },
    {
      heading: '7. CONFIDENTIALITY',
      paragraphs: [
        'Both Parties agree to keep all proprietary and confidential information received from the other Party private and not disclose it to any third party without prior written consent, except as required by law.',
      ],
    },
    {
      heading: '8. INDEPENDENT CONTRACTOR',
      paragraphs: [
        'Salesability will perform the Services as an independent contractor. This Agreement does not constitute and shall not be construed as constituting or creating a partnership, joint venture, principal/agent relationship or a formal business organization between the Parties.',
      ],
    },
    {
      heading: '9. GOVERNING LAW',
      paragraphs: [
        'This Agreement shall be deemed to have been made in and shall be governed by, construed and interpreted in accordance with the laws of the Province of Nova Scotia and the laws of Canada, as applicable therein.',
      ],
    },
    {
      heading: '10. GENERAL PROVISIONS',
      paragraphs: [
        'i. Legally Binding Agreement. This Agreement shall be a binding, legal agreement between the Parties.',
        'ii. Entire Agreement. This Agreement, together with any agreements and other documents to be delivered pursuant hereto, including any Quote, constitutes the entire agreement between the Parties pertaining to the subject matter hereof and supersedes all prior agreements, negotiations, discussions, and understandings, written or oral, between the Parties.',
        'iii. Modification. Any modifications to this Agreement must be in writing and signed by both Parties.',
        'iv. Severability. If any provision of this Agreement or of a Quote is deemed unenforceable, the remainder of the Agreement and/or Quote shall remain in full effect.',
        'v. Signature. By signing this Agreement, the Client acknowledges and agrees that it has fully read, understood and agreed to be legally bound by this Master Services Agreement.',
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
    page.drawText('MASTER SERVICES AGREEMENT', {
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

    // Recitals — verbatim opening paragraph of the lawyer's agreement, with
    // the Client's legal name interpolated where the source reads "[insert
    // client's legal name]". Rendered as wrapped prose, not a form, so the
    // signed document reads as the agreement itself.
    const recitals =
      'This Master Services Agreement (the "Agreement") is made by and between ' +
      'Salesability Canada Inc., a company incorporated under the laws of Canada ' +
      `(hereinafter called "Salesability") and ${data.clientName} (hereinafter ` +
      'called the "Client") (collectively, Salesability and the Client are ' +
      'referred to herein as the "Parties", and each of them as a "Party").';
    for (const line of wrap(sanitize(recitals), 95)) {
      page.drawText(line, { x: margin, y, size: 9, font, color: black });
      y -= 12;
    }
    // Client address (optional) printed beneath the recitals for identification.
    if (data.clientAddress) {
      y -= 4;
      for (const line of data.clientAddress) {
        page.drawText(sanitize(line), { x: margin, y, size: 9, font, color: grey });
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
    page.drawText(sanitize('Shannon Tilley, President'), {
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
