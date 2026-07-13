// Side-effect env loader for integration tests whose import graph reaches the
// APP db pool (`@/lib/db` captures DATABASE_URL at module-evaluation time).
// Import this FIRST — before any `@/…` import — so `.env.local` is loaded
// before the pool's URL is read. Tests that only build their own postgres()
// client don't need this (they load env in the module body, after imports).

try {
  process.loadEnvFile('.env.local');
} catch {
  // missing file → the describe.skipIf(!dbUrl) in the test handles it
}
