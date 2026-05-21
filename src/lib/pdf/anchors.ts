// Shared form-field anchor shape for BoldSign fields, produced by the PDF
// renderers and consumed by the merge step (`merge.ts`) and the BoldSign
// client (`src/lib/boldsign/client.ts`). Coordinates use BoldSign's system:
// top-left origin, page units (points), 1-indexed page number. The renderers
// translate from pdf-lib's bottom-left origin at capture time, so consumers
// never deal with pdf-lib's convention.
export type FieldAnchor = {
  /** 1-indexed page number (BoldSign convention). */
  pageNumber: number;
  /** Top-left origin, page units (points). */
  x: number;
  y: number;
  width: number;
  height: number;
};
