import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';
import type { AppConfig } from '../config.js';

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Migrations folder: apps/api/drizzle (works from src/ and the bundled dist/). */
export const MIGRATIONS_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'drizzle',
);
function migrationsDir(): string {
  // src/db/client.ts → ../../drizzle ; dist/server.js → ../drizzle
  const fromSrc = MIGRATIONS_DIR;
  const fromDist = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'drizzle');
  try {
    readFileSync(resolve(fromSrc, 'meta/_journal.json'));
    return fromSrc;
  } catch {
    return fromDist;
  }
}

export function createDatabase(
  config: Pick<AppConfig, 'databaseUrl' | 'databaseSsl' | 'databasePoolMax'>,
): Database {
  const ssl =
    config.databaseSsl === 'disable'
      ? false
      : { rejectUnauthorized: config.databaseSsl === 'verify-full' };
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    application_name: 'recall-studio',
  });
  // Prevent an idle-client error from crashing the process; queries surface their own errors.
  pool.on('error', () => {});
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsDir() });
}

/** Describe connection failures without echoing credentials. */
export function describeDbError(error: unknown): string {
  const err = error as { code?: string; message?: string };
  switch (err.code) {
    case 'ECONNREFUSED':
      return 'Could not connect to PostgreSQL (connection refused). Is the server running and is the host/port in DATABASE_URL correct?';
    case 'ENOTFOUND':
      return 'PostgreSQL host in DATABASE_URL could not be resolved.';
    case '28P01':
      return 'PostgreSQL rejected the username/password in DATABASE_URL.';
    case '3D000':
      return 'The database named in DATABASE_URL does not exist. Create it first (see README).';
    case '42P01':
      return 'Database tables are missing. Run: pnpm db:migrate';
    default:
      return `PostgreSQL error${err.code ? ` ${err.code}` : ''}: ${(err.message ?? 'unknown error').replace(/postgres(ql)?:\/\/\S+/g, '[redacted-url]')}`;
  }
}

/** Startup check: database reachable and every bundled migration applied. */
export async function checkDatabase(
  database: Database,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await database.pool.query('select 1');
  } catch (error) {
    return { ok: false, message: describeDbError(error) };
  }
  try {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir(), 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: unknown[];
    };
    const result = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    const applied = Number(result.rows[0]?.count ?? 0);
    if (applied < journal.entries.length) {
      return {
        ok: false,
        message: `Database has ${applied}/${journal.entries.length} migrations applied. Run: pnpm db:migrate`,
      };
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '3F000') {
      return { ok: false, message: 'Database is not initialised. Run: pnpm db:migrate' };
    }
    return { ok: false, message: describeDbError(error) };
  }
  return { ok: true };
}
