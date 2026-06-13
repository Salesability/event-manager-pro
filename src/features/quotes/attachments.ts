// Shared quote-attachment constants + pure helpers (0078 — local-upload spine).
//
// **No `'server-only'` / `'use server'`.** Both the client send dialog
// (`quote-composer.tsx`) and the server actions (`actions.ts` upload + send)
// import from here so the MIME allowlist and the size caps can never drift
// between the client-side pre-check and the server-side enforcement. Keep this
// module free of DB / GCS / Node imports.

// Per-file upload cap — 10 MB (owner decision 2026-06-12).
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Total outgoing-email payload cap (quote PDF + every attachment) — 20 MB.
// Comfortable headroom under Resend's ~40 MB message ceiling once base64
// inflation (~33%) is accounted for (owner decision 2026-06-12). The send
// action (`sendQuote`) is the authoritative check; the dialog hints against it.
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// Allowed upload types: PDF + images + common Office docs (owner decision).
// `mime` is matched server-side; `ext` widens the `<input accept>` so browsers
// that filter by extension also offer these files.
export const ATTACHMENT_TYPES: ReadonlyArray<{
  mime: string;
  ext: string;
  label: string;
}> = [
  { mime: 'application/pdf', ext: '.pdf', label: 'PDF' },
  { mime: 'image/png', ext: '.png', label: 'PNG' },
  { mime: 'image/jpeg', ext: '.jpg', label: 'JPEG' },
  { mime: 'image/webp', ext: '.webp', label: 'WEBP' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
    label: 'Word',
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
    label: 'Excel',
  },
];

const ALLOWED_MIME = new Set(ATTACHMENT_TYPES.map((t) => t.mime));

export function isAllowedAttachmentType(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

// `accept` attribute for the `<input type="file">` — MIME types plus extensions.
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.flatMap((t) => [
  t.mime,
  t.ext,
]).join(',');

// Human-readable type list for the dialog hint ("PDF, PNG, JPEG, …").
export const ATTACHMENT_TYPE_LABELS = ATTACHMENT_TYPES.map((t) => t.label).join(
  ', ',
);

// Compact byte formatter for the dialog (e.g. "1.4 MB", "812 KB").
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Strip path separators + cap length on a user filename for display + the email
// attachment name. Keeps the original spelling (spaces included) — the GCS key
// gets the stricter `attachmentStorageKey` sanitizer instead.
export function cleanDisplayFilename(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? name).trim();
  return base.slice(0, 200) || 'file';
}

// Sanitize a filename into a single safe GCS key segment: ASCII word chars,
// dots, dashes only. Collapses everything else to `_` so a crafted name can't
// escape the `quotes/{id}/attachments/` prefix.
export function sanitizeAttachmentFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return (
    base
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'file'
  );
}

// GCS key for an uploaded attachment. The `uuid` prefix avoids collisions when
// the same filename is re-uploaded to the same quote.
export function attachmentStorageKey(
  quoteId: number,
  uuid: string,
  filename: string,
): string {
  return `quotes/${quoteId}/attachments/${uuid}-${sanitizeAttachmentFilename(filename)}`;
}

// View-model for one attachment row — the slice the send dialog renders.
export type QuoteAttachmentView = {
  id: number;
  filename: string;
  contentType: string;
  byteSize: number;
};
