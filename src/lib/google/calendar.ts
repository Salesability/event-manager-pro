import 'server-only';
import { GoogleAuth } from 'google-auth-library';

// Google Calendar API client (chunk 0077). Pure HTTP — no DB, no SDK beyond
// google-auth-library (used only to resolve the base ADC identity that signs
// the DWD assertion). Mirrors the shape of ../quickbooks/client.ts.
//
// Auth is KEYLESS (decision.md §4a): there is no downloaded service-account key
// (org policy blocks key creation). Instead the base identity — the Cloud Run
// runtime SA in prod, the developer's ADC locally — calls IAM Credentials
// `signJwt` to have the `eventpro-calendar` SA sign a domain-wide-delegation
// assertion (`sub` = the organizer subject), which is exchanged for an access
// token acting as that subject. Validated end-to-end by the Phase 0 smoke.
//
// Event organizer note: events written here live on the configured calendar, so
// the *organizer* dealers see is that calendar's display name (NOT the subject —
// the subject is only the `creator`). See decision.md §3.

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const signJwtUrl = (saEmail: string) =>
  `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:signJwt`;

export type GoogleCalendarConfig = {
  /** The SA whose Google-managed key signs the DWD assertion (keyless via signJwt). */
  saEmail: string;
  /** The calendar events are written to (its display name is the dealer-facing organizer). */
  calendarId: string;
  /** The Workspace user impersonated via DWD — the event `creator`, required to invite guests. */
  subject: string;
};

/** A Calendar API error. `status` carries the HTTP status when one is available
 *  (e.g. 404/410 lets a caller treat a patched-but-deleted event as "gone"). */
export class GoogleCalendarError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
/** Thrown when the keyless token exchange fails (vs. a generic Calendar API error). */
export class GoogleCalendarAuthError extends GoogleCalendarError {}

/** Non-throwing presence check — lets callers hint "not configured" before invoking. */
export function googleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_SA_EMAIL?.trim() &&
      process.env.GOOGLE_CALENDAR_ID?.trim() &&
      process.env.GOOGLE_CALENDAR_SUBJECT?.trim()
  );
}

export function googleCalendarConfig(): GoogleCalendarConfig {
  const saEmail = process.env.GOOGLE_CALENDAR_SA_EMAIL?.trim();
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();
  const subject = process.env.GOOGLE_CALENDAR_SUBJECT?.trim();
  if (!saEmail || !calendarId || !subject) {
    throw new Error(
      'GOOGLE_CALENDAR_SA_EMAIL / GOOGLE_CALENDAR_ID / GOOGLE_CALENDAR_SUBJECT are not set.'
    );
  }
  return { saEmail, calendarId, subject };
}

// --- keyless DWD auth -------------------------------------------------------

let baseAuth: GoogleAuth | null = null;
function googleAuth(): GoogleAuth {
  baseAuth ??= new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  return baseAuth;
}

// Per-instance cache of the impersonated access token (Cloud Run instances are
// ephemeral, so this just trims repeat round-trips within one instance).
let tokenCache: { subject: string; token: string; expiresAt: number } | null = null;

async function impersonatedAccessToken(cfg: GoogleCalendarConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.subject === cfg.subject && tokenCache.expiresAt - 60 > now) {
    return tokenCache.token;
  }

  // 1. Have the SA sign a DWD assertion — keyless (Google holds the key).
  const claims = {
    iss: cfg.saEmail,
    sub: cfg.subject,
    scope: CALENDAR_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  let signedJwt: string;
  try {
    const client = await googleAuth().getClient();
    const signed = await client.request<{ signedJwt: string }>({
      url: signJwtUrl(cfg.saEmail),
      method: 'POST',
      data: { payload: JSON.stringify(claims) },
    });
    signedJwt = signed.data.signedJwt;
  } catch (err) {
    throw new GoogleCalendarAuthError(
      `signJwt failed for ${cfg.saEmail}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 2. Exchange the assertion for an access token acting as the subject.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion: signedJwt }),
  });
  if (!res.ok) {
    throw new GoogleCalendarAuthError(`token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = {
    subject: cfg.subject,
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
  };
  return json.access_token;
}

// --- event types ------------------------------------------------------------

export type GcalDate = { date?: string; dateTime?: string; timeZone?: string };
export type GcalAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  optional?: boolean;
};
export type GcalReminders = {
  useDefault: boolean;
  overrides?: { method: 'email' | 'popup'; minutes: number }[];
};

/** The subset of the Calendar event resource this app writes. */
export type GcalEventInput = {
  summary: string;
  location?: string;
  description?: string;
  start: GcalDate;
  end: GcalDate;
  colorId?: string;
  attendees?: GcalAttendee[];
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  reminders?: GcalReminders;
  source?: { title: string; url: string };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  visibility?: 'default' | 'public' | 'private';
  transparency?: 'opaque' | 'transparent';
};

export type GcalEvent = GcalEventInput & {
  id: string;
  status?: string;
  htmlLink?: string;
  organizer?: { email: string; displayName?: string; self?: boolean };
  creator?: { email: string; displayName?: string };
};

export type SendUpdates = 'all' | 'externalOnly' | 'none';

/** Build the events endpoint URL, encoding the calendar id (`@`) and event id. */
export function eventsUrl(calendarId: string, eventId?: string, sendUpdates: SendUpdates = 'all'): string {
  const base = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const path = eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  return `${path}?sendUpdates=${sendUpdates}`;
}

async function asEvent(res: Response): Promise<GcalEvent> {
  if (!res.ok) {
    throw new GoogleCalendarError(`calendar API error (${res.status}): ${await res.text()}`, res.status);
  }
  return (await res.json()) as GcalEvent;
}

// --- event operations -------------------------------------------------------

export async function createEvent(
  event: GcalEventInput,
  sendUpdates: SendUpdates = 'all'
): Promise<GcalEvent> {
  const cfg = googleCalendarConfig();
  const token = await impersonatedAccessToken(cfg);
  const res = await fetch(eventsUrl(cfg.calendarId, undefined, sendUpdates), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  return asEvent(res);
}

export async function patchEvent(
  eventId: string,
  patch: Partial<GcalEventInput>,
  sendUpdates: SendUpdates = 'all'
): Promise<GcalEvent> {
  const cfg = googleCalendarConfig();
  const token = await impersonatedAccessToken(cfg);
  const res = await fetch(eventsUrl(cfg.calendarId, eventId, sendUpdates), {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return asEvent(res);
}

/** Idempotent: a 404/410 (already gone) is treated as success. */
export async function deleteEvent(eventId: string, sendUpdates: SendUpdates = 'all'): Promise<void> {
  const cfg = googleCalendarConfig();
  const token = await impersonatedAccessToken(cfg);
  const res = await fetch(eventsUrl(cfg.calendarId, eventId, sendUpdates), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new GoogleCalendarError(`deleteEvent failed (${res.status}): ${await res.text()}`, res.status);
  }
}
