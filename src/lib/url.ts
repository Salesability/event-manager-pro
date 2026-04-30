// Constrain a `?next=…` redirect target to a same-origin path. Anything that
// could escape the origin (protocol-relative `//evil.com`, absolute URLs, or
// non-strings from FormData/searchParams) collapses to '/'.
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
