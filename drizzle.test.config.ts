import { defineConfig } from 'drizzle-kit';

// chunk 0063: drizzle-kit config for the DISPOSABLE test Postgres ONLY.
//
// Keyed on `TEST_DATABASE_URL` — never `DATABASE_URL` — so the test-db harness
// physically cannot target the shared Supabase DB, even if drizzle-kit autoloads
// `.env.local` (which sets `DATABASE_URL`). Belt-and-suspenders: also refuses
// any non-local host.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    'TEST_DATABASE_URL is required for the test-db config (use `pnpm db:test:reset`).',
  );
}
const host = new URL(url).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error(
    `Refusing to target non-local host "${host}" with the test-db config — this harness is local-only.`,
  );
}

export default defineConfig({
  schema: './src/lib/db/schema',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: { url },
});
