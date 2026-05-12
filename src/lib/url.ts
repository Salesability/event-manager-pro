// Constrain a `?next=…` redirect target to a same-origin path. Anything that
// could escape the origin (protocol-relative `//evil.com`, absolute URLs, or
// non-strings from FormData/searchParams) collapses to '/'.
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

/** Canonical origin for outbound links (e.g. quote accept-link URLs). Reads
 *  `SITE_URL`; throws if unset because every email/share path needs an
 *  absolute URL the recipient's client can resolve. The `.env.example` line
 *  for `SITE_URL` documents the requirement. */
export function siteUrl(path = '/'): string {
  const origin = process.env.SITE_URL?.trim();
  if (!origin) {
    throw new Error('SITE_URL is not set; cannot build an outbound URL.');
  }
  const trimmedOrigin = origin.replace(/\/$/, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedOrigin}${trimmedPath}`;
}
