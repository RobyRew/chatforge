import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../env';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

let cached: DB | undefined;

/**
 * Singleton Drizzle/Postgres client. The `pg` Pool connects lazily (on first query), so
 * importing this module never requires a live database — typecheck/build and the converter
 * path work without Postgres. Set DATABASE_URL to point at Postgres (see docker-compose.yml).
 */
export function getDb(): DB {
  if (!cached) {
    const { databaseUrl } = loadEnv();
    const pool = new Pool(databaseUrl ? { connectionString: databaseUrl } : {});
    cached = drizzle(pool, { schema });
  }
  return cached;
}
