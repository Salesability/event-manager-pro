// Demo-seed runner (0111): walks the ordered module registry against the
// shared sandbox DB. Generalizes the per-chunk `insert|cleanup` smoke-fixture
// pattern (scripts/0108-booking-smoke.ts, scripts/0110-console-polish-smoke.ts)
// into permanent, marker-owned modules. Idempotency lives in the modules, not
// in a DB reset: every seeded row carries a harness marker (`demo-` publicIds,
// the reserved +1999 phone block), and each module cleans its own marker scope
// before seeding — a scoped reset that cannot touch real rows.
//
// Usage:
//   pnpm seed:demo                       # clean-then-seed every module, in order
//   pnpm seed:demo --clean               # clean only, in REVERSE order (FK-safe)
//   pnpm seed:demo --only 20-sms-recipients
//
// DATABASE_URL comes from the environment, falling back to .env.local (the
// integration-test pattern — an explicitly exported var wins). The target
// guard (guard.ts) runs before any client is constructed.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/db/schema';
import { classifySeedTarget, UNKNOWN_TARGET_OPTIN } from './guard';
import type { SeedModule } from './types';

import { demoDealerModule } from './10-demo-dealer';
import { smsRecipientsModule } from './20-sms-recipients';
import { smsHistoryModule } from './30-sms-history';

// Ordered registry — seed walks it forward, clean walks it backward. An
// explicit array (not an fs walk) keeps ordering deterministic and the module
// graph type-checked; new modules are appended here as they land.
const MODULES: SeedModule[] = [demoDealerModule, smsRecipientsModule, smsHistoryModule];

function usage(): never {
  console.error('Usage: pnpm seed:demo [--clean] [--only <module-name>]');
  console.error(`Modules: ${MODULES.map((m) => m.name).join(', ') || '(none registered yet)'}`);
  process.exit(64);
}

const args = process.argv.slice(2);
let cleanOnly = false;
let only: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--clean') cleanOnly = true;
  else if (args[i] === '--only') {
    only = args[++i] ?? null;
    if (!only) usage();
  } else usage();
}

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local (CI, bare shell) — the guard below reports the missing URL.
  }
}

const verdict = classifySeedTarget(
  process.env.DATABASE_URL,
  process.env[UNKNOWN_TARGET_OPTIN] === '1',
);
if (!verdict.ok) {
  console.error(`❌ ${verdict.reason}`);
  process.exit(1);
}
console.log(`🎯 Seed target: ${verdict.label}`);

const selected = only ? MODULES.filter((m) => m.name === only) : MODULES;
if (only && !selected.length) {
  console.error(`❌ No module named "${only}".`);
  usage();
}
if (!selected.length) {
  console.log('No seed modules registered yet — nothing to do.');
  process.exit(0);
}

const pg = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(pg, { schema });

async function run() {
  // Clean is always a full reverse pass over the selection BEFORE any seeding:
  // later modules hold `restrict` FKs into earlier ones (sends/threads →
  // campaign), so interleaving clean-then-seed per module would fail on the
  // second run. Reverse-clean-everything + forward-seed-everything is the
  // FK-safe idempotent shape.
  for (const mod of [...selected].reverse()) {
    console.log(`🧹 clean ${mod.name}`);
    await mod.clean(db);
  }
  if (cleanOnly) {
    console.log(`Cleaned ${selected.length} module(s).`);
    return;
  }
  for (const mod of selected) {
    console.log(`🌱 seed  ${mod.name}`);
    await mod.seed(db);
  }
  console.log(`Seeded ${selected.length} module(s).`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end({ timeout: 5 }));
