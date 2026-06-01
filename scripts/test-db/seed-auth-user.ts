// chunk 0063 — mirror a real Supabase auth user into the test container's stub
// `auth.users` table, so writes that stamp `created_by_id`/`updated_by_id`
// (the session user's uuid) satisfy the FK to auth.users.
//
// The harness runs the app in a hybrid mode: Drizzle queries hit the local
// container, but Supabase auth stays on the real project — so the session
// carries a real uuid that the container's (empty) stub auth.users doesn't
// know. Reads are fine; the first write (e.g. createQuote) FK-fails without
// this. Idempotent (ON CONFLICT DO NOTHING).
//
// Run: `pnpm db:test:seed:auth` (loads .env.local + .claude/tools/browse/.env
// itself). Or `pnpm exec tsx scripts/test-db/seed-auth-user.ts <email>`.
//
// Targets TEST_DATABASE_URL (a localhost container, default port 55432) ONLY —
// refuses a non-local host so it can never write to the shared DB.

import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// Self-load the env files a standalone tsx run doesn't get (Next loads these
// for the app, not for scripts). Existing process.env wins.
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.replace(/^(['"])(.*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.claude/tools/browse/.env');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/event_manager_test';
const email = (process.argv[2] ?? process.env.BROWSE_AUTH_EMAIL ?? '').trim().toLowerCase();

if (!SUPABASE_URL || !SERVICE_KEY || !TEST_DATABASE_URL) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_DATABASE_URL');
  process.exit(1);
}
if (!email) {
  console.error('No email. Pass as arg or set BROWSE_AUTH_EMAIL.');
  process.exit(1);
}
const host = new URL(TEST_DATABASE_URL).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`Refusing to write to non-local host "${host}".`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sql = postgres(TEST_DATABASE_URL, { prepare: false });

async function main() {
  // listUsers paginates; this app has < 1000 users so one page suffices.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.error(`No Supabase auth user with email ${email}.`);
    process.exit(1);
  }
  await sql`
    insert into auth.users (id, email) values (${user.id}, ${email})
    on conflict (id) do nothing
  `;
  console.log(`Mirrored auth user ${email} (${user.id}) into the test container's auth.users.`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
