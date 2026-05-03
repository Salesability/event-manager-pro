import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Cache the postgres() client on globalThis in dev so Next's HMR reuses one
// client across module re-evaluations instead of leaking a fresh one per save —
// exhausts the Supabase pooler (`EMAXCONNSESSION`, pool_size: 15) within minutes
// otherwise. In prod the module is evaluated once, so the cache is a no-op.
const globalForDb = globalThis as unknown as { _pg?: ReturnType<typeof postgres> };
const client = globalForDb._pg ?? postgres(process.env.DATABASE_URL!, { prepare: false });
if (process.env.NODE_ENV !== 'production') globalForDb._pg = client;

export const db = drizzle(client, { schema });
