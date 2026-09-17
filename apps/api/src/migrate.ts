import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { loadEnv } from './env';

/**
 * Applies the SQL migrations in `drizzle/` and exits. This is the production entry point used
 * by the API image instead of `drizzle-kit migrate`: drizzle-kit (like tsx) ships esbuild, a Go
 * binary whose bundled standard library carried 22 HIGH/CRITICAL CVEs in the runtime image scan
 * of 2026-09-16. drizzle-orm's migrator reads the same journal and writes the same
 * `drizzle.__drizzle_migrations` table, so a database migrated by `drizzle-kit migrate` before
 * continues from here without re-applying anything.
 *
 * The migrations folder is resolved next to the compiled bundle (`dist/../drizzle`) so the image
 * only has to copy `drizzle/` alongside `dist/`; DRIZZLE_MIGRATIONS_DIR overrides it.
 */
async function main(): Promise<void> {
  const { databaseUrl } = loadEnv();
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations');
  const migrationsFolder =
    process.env.DRIZZLE_MIGRATIONS_DIR ?? fileURLToPath(new URL('../drizzle', import.meta.url));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    // eslint-disable-next-line no-console
    console.log(`[migrate] migrations up to date (${migrationsFolder})`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed:', err);
  process.exit(1);
});
