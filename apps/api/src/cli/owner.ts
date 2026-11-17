/**
 * One-time local owner bootstrap and password reset. There is no HTTP registration.
 *   pnpm owner:create     — create the single owner account (refuses if one exists)
 *   pnpm owner:password   — set a new password and sign out all sessions
 * Non-interactive use: set RS_OWNER_USERNAME / RS_OWNER_PASSWORD in the environment for one run.
 */
import { eq, sql } from 'drizzle-orm';
import { authSessions, owners } from '../db/schema.js';
import { hashPassword, passwordProblems } from '../auth/password.js';
import { dbFail, fail, openDatabaseFromEnv, prompt, promptHidden } from './common.js';

const command = process.argv[2];
if (command !== 'create' && command !== 'password') fail('Usage: owner.ts create|password');

const database = openDatabaseFromEnv();
const { db } = database;

async function askPassword(username: string): Promise<string> {
  const fromEnv = process.env.RS_OWNER_PASSWORD;
  const password = fromEnv ?? (await promptHidden('Password (min 12 characters): '));
  const problems = passwordProblems(password, username);
  if (problems.length) fail(problems.join(' '));
  if (!fromEnv) {
    const again = await promptHidden('Repeat password: ');
    if (again !== password) fail('Passwords do not match.');
  }
  return password;
}

try {
  const [existing] = await db.select().from(owners).limit(1);
  if (command === 'create') {
    if (existing)
      fail(
        `An owner account ("${existing.username}") already exists. Use pnpm owner:password to reset its password.`,
      );
    const username = process.env.RS_OWNER_USERNAME ?? (await prompt('Username: '));
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username))
      fail('Username must be 3–64 characters: letters, digits, ".", "_" or "-".');
    const password = await askPassword(username);
    await db
      .insert(owners)
      .values({ username, displayName: username, passwordHash: await hashPassword(password) });
    console.log(`✔ Owner "${username}" created. Start the app and sign in.`);
  } else {
    if (!existing) fail('No owner exists yet. Run pnpm owner:create first.');
    const password = await askPassword(existing.username);
    await db.transaction(async (tx) => {
      await tx
        .update(owners)
        .set({
          passwordHash: await hashPassword(password),
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(owners.id, existing.id));
      await tx
        .update(authSessions)
        .set({ revokedAt: sql`now()` })
        .where(eq(authSessions.ownerId, existing.id));
    });
    console.log(
      `✔ Password updated for "${existing.username}". All existing sessions were signed out.`,
    );
  }
} catch (error) {
  const code =
    (error as { code?: string; cause?: { code?: string } }).code ??
    (error as { cause?: { code?: string } }).cause?.code;
  if (code === '23505') fail('An owner account already exists.');
  dbFail(error);
} finally {
  await database.close();
}
