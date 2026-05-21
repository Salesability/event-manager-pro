import 'server-only';
import { PDFDocument } from 'pdf-lib';
import type { FieldAnchor } from './anchors';

// Combine the prospect-facing Quote and the MSA into a single signable PDF —
// the "one whole document" the Client initials and signs once (chunk 0055).
//
// Order is **Quote first, Agreement last**, so the signature block (the end of
// the MSA) is literally the bottom of the combined document — matching the
// owner's "agreed-to quote with initials and sign the bottom of contract page,
// one and done". Flipping the order is a one-line swap of the two copy loops
// plus the anchor-shift base.
//
// pdf-lib `copyPages` clones each source page verbatim (content stream + fonts
// + images), so neither the Quote nor the lawyer's clause text reflows — no
// re-layout, no risk of altering the agreement's wording or pagination.
//
// Anchor bookkeeping after the merge:
//   - The Quote's initials anchor(s) keep their page numbers — the Quote is
//     first, so its pages aren't renumbered.
//   - The MSA's signature anchor is captured relative to the MSA's *own* pages
//     (1-indexed); after the Quote pages are prepended it shifts by the Quote's
//     page count. x/y/width/height are unchanged because both renderers emit
//     US-Letter (612×792) pages with the same origin convention.

export type CombineResult =
  | {
      ok: true;
      body: Buffer;
      signatureAnchor: FieldAnchor;
      initialsAnchors: FieldAnchor[];
    }
  | { error: string };

export async function combineQuoteAndMsa(
  quote: { body: Buffer; initialsAnchor?: FieldAnchor },
  msa: { body: Buffer; signatureAnchor: FieldAnchor },
): Promise<CombineResult> {
  try {
    const out = await PDFDocument.create();
    const quoteDoc = await PDFDocument.load(quote.body);
    const msaDoc = await PDFDocument.load(msa.body);

    const quotePages = await out.copyPages(quoteDoc, quoteDoc.getPageIndices());
    for (const page of quotePages) out.addPage(page);
    const quotePageCount = quotePages.length;

    const msaPages = await out.copyPages(msaDoc, msaDoc.getPageIndices());
    for (const page of msaPages) out.addPage(page);

    const bytes = await out.save();
    return {
      ok: true,
      body: Buffer.from(bytes),
      signatureAnchor: {
        ...msa.signatureAnchor,
        pageNumber: quotePageCount + msa.signatureAnchor.pageNumber,
      },
      // Quote-first → initials page numbers carry over unchanged.
      initialsAnchors: quote.initialsAnchor ? [quote.initialsAnchor] : [],
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'combineQuoteAndMsa failed.',
    };
  }
}
