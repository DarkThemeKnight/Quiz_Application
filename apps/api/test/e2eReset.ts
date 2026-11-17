/**
 * Prepares the Playwright database: wipes E2E_DATABASE_URL, migrates it and creates a throwaway
 * owner. Refuses to touch DATABASE_URL or TEST_DATABASE_URL.
 */
import { sql } from 'drizzle-orm';
import { loadEnvFile } from '../src/config.js';
import { createDatabase, runMigrations } from '../src/db/client.js';
import { owners } from '../src/db/schema.js';
import { hashPassword } from '../src/auth/password.js';

loadEnvFile();
const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error('E2E_DATABASE_URL is not set');
if (url === process.env.DATABASE_URL || url === process.env.TEST_DATABASE_URL) {
  throw new Error('E2E_DATABASE_URL must be a separate database — it is wiped on every run.');
}
const database = createDatabase({ databaseUrl: url, databaseSsl: 'disable', databasePoolMax: 2 });
await database.db.execute(sql`drop schema if exists public cascade`);
await database.db.execute(sql`drop schema if exists drizzle cascade`);
await database.db.execute(sql`create schema public`);
await runMigrations(database.db);
await database.db.insert(owners).values({
  username: process.env.E2E_USERNAME ?? 'e2e-owner',
  displayName: 'E2E Owner',
  passwordHash: await hashPassword(process.env.E2E_PASSWORD ?? 'e2e-password-not-secret'),
});
await database.close();
console.log('e2e database ready');
