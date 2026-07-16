// Module contract for the demo-seed harness (0111). Lives apart from
// index.ts so seed modules can import the types without executing the
// runner's top-level CLI code.

import type { drizzle } from 'drizzle-orm/postgres-js';
import type * as schema from '../../src/lib/db/schema';

export type SeedDb = ReturnType<typeof drizzle<typeof schema>>;

export type SeedModule = {
  /** Filename-style ordered name, e.g. '10-demo-dealer' — the `--only` key. */
  name: string;
  /** Insert this module's marker-owned rows. Runs after `clean`. */
  seed(db: SeedDb): Promise<void>;
  /** Remove every row in this module's marker scope. Idempotent. */
  clean(db: SeedDb): Promise<void>;
};
