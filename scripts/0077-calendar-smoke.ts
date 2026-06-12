// Live create → patch → delete round-trip against Google Calendar (chunk 0077,
// Phase 5). Exercises the COMMITTED keyless client (`src/lib/google/calendar.ts`)
// + the real mapper end-to-end — the productionised version of the ad-hoc
// Phase-0 smoke. Confirms the keyless+DWD chain still authorises, attendees can
// be invited (DWD), and the organizer dealers see is the CALENDAR's display
// name, not the impersonated subject (decision.md §3).
//
// No DB, no emails: it builds a throwaway event with example.test guests and
// uses sendUpdates='none' so nobody is actually notified, then deletes it (and
// re-deletes to prove idempotency). Safe to run repeatedly.
//
// Usage (needs ADC with tokenCreator on eventpro-calendar + GOOGLE_CALENDAR_*):
//   set -a && source .env.local && set +a && \
//     NODE_OPTIONS='--conditions=react-server' pnpm dlx tsx scripts/0077-calendar-smoke.ts
//
// The `--conditions=react-server` flag makes `import 'server-only'` resolve to an
// empty module so the client loads outside Next.

import {
  createEvent,
  deleteEvent,
  googleCalendarConfig,
  googleCalendarConfigured,
  patchEvent,
} from '../src/lib/google/calendar';
import { addDaysIso, mapCampaignToGcalEvent } from '../src/lib/google/calendar-event';

async function main() {
  if (!googleCalendarConfigured()) {
    console.error(
      'Not configured. Set GOOGLE_CALENDAR_SA_EMAIL / GOOGLE_CALENDAR_ID / GOOGLE_CALENDAR_SUBJECT in .env.local.',
    );
    process.exit(1);
  }
  const cfg = googleCalendarConfig();
  console.log(`Calendar: ${cfg.calendarId}\nSubject:  ${cfg.subject}\nSA:       ${cfg.saEmail}\n`);

  // A near-future throwaway day so the event is easy to spot if cleanup is skipped.
  const start = addDaysIso(new Date().toISOString().slice(0, 10), 30);
  const event = mapCampaignToGcalEvent(
    {
      id: -1,
      publicId: 'smoke',
      startDate: start,
      endDate: start, // single day → Google end is start + 1 (EXCLUSIVE)
      styleLabel: 'In-Store Event',
      contact: 'Smoke Contact',
      phone: '555-0000',
      email: 'dealer@example.test',
    },
    { name: '__0077 SMOKE — delete me__', address: '1 Test Rd' },
    { name: 'Smoke Coach', email: 'coach@example.test', colorId: '5' },
    'https://app.example.test/calendar',
  );

  console.log('Creating event (sendUpdates=none — no real invites)…');
  const created = await createEvent(event, 'none');
  console.log(`  id:        ${created.id}`);
  console.log(`  organizer: ${JSON.stringify(created.organizer)}`);
  console.log(`  creator:   ${JSON.stringify(created.creator)}`);
  console.log(`  htmlLink:  ${created.htmlLink}\n`);

  console.log('Patching event (summary suffix + colour)…');
  const patched = await patchEvent(
    created.id,
    { summary: '__0077 SMOKE — delete me__ (patched)', colorId: '7' },
    'none',
  );
  console.log(`  summary:   ${patched.summary}\n`);

  console.log('Deleting event…');
  await deleteEvent(created.id, 'none');
  console.log('  deleted.');
  console.log('Re-deleting (should be idempotent — 404/410 = success)…');
  await deleteEvent(created.id, 'none');
  console.log('  idempotent delete ok.\n');
  console.log('✅ Round-trip PASSED — keyless+DWD chain + client wrapper verified.');
}

main().catch((err) => {
  console.error('❌ Round-trip FAILED:', err);
  process.exit(1);
});
