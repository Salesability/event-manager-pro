// Display identity for a Quote. The DB key `quotes.id` is no longer user-visible;
// readers identify a quote by its creation timestamp rendered as
// `Quote-YYYYMMDD-HHmm` in America/Toronto (the project's display timezone).
//
// Format is filename-safe (no colons / spaces / slashes), human-readable, and
// lexicographically sortable. Seconds are omitted — collision risk at
// quote-creation rates is negligible and shorter names email better.
const NAME_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function quoteDisplayName(createdAt: Date): string {
  const parts = NAME_PARTS.formatToParts(createdAt);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  // `en-CA` returns 24h hour as `24` at midnight; normalize to `00`.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `Quote-${get('year')}${get('month')}${get('day')}-${hour}${get('minute')}`;
}

export function quoteDownloadFilename(createdAt: Date): string {
  return `saledayevents-${quoteDisplayName(createdAt)}.pdf`;
}
