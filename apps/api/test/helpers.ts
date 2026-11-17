import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadEnvFile, parseConfig, type AppConfig } from '../src/config.js';
import { createDatabase, runMigrations, type Database } from '../src/db/client.js';
import { owners } from '../src/db/schema.js';
import { hashPassword } from '../src/auth/password.js';
import { resetLoginFailures } from '../src/routes/auth.js';

export const ORIGIN = 'http://127.0.0.1:5173';
export const USERNAME = 'tester';
export const PASSWORD = 'correct horse battery staple';

let cachedHash: string | null = null;

export function testConfig(): AppConfig {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set (see README "Running tests").');
  if (url === process.env.DATABASE_URL)
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL — tests wipe the database.');
  return parseConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    DATABASE_URL: url,
    SESSION_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    LOG_LEVEL: 'silent',
  });
}

export interface TestContext {
  app: FastifyInstance;
  database: Database;
  config: AppConfig;
  cookie: string;
  ownerId: string;
}

/** Fresh schema per test file: drop everything, migrate, create an owner, sign in. */
export async function setupTestApp(): Promise<TestContext> {
  const config = testConfig();
  const database = createDatabase(config);
  await database.db.execute(sql`drop schema if exists public cascade`);
  await database.db.execute(sql`drop schema if exists drizzle cascade`);
  await database.db.execute(sql`create schema public`);
  await runMigrations(database.db);
  cachedHash ??= await hashPassword(PASSWORD);
  const [owner] = await database.db
    .insert(owners)
    .values({ username: USERNAME, displayName: 'Tester', passwordHash: cachedHash })
    .returning({ id: owners.id });
  resetLoginFailures();
  const app = await buildApp({ config, database });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { username: USERNAME, password: PASSWORD },
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  const cookie = cookieFrom(login);
  return { app, database, config, cookie, ownerId: owner?.id ?? '' };
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  return (value ?? '').split(';')[0] ?? '';
}

export async function teardown(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.database.close();
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Authenticated JSON request helper. */
export function api(ctx: TestContext) {
  return async <T = unknown>(method: Method, url: string, payload?: unknown) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: { origin: ORIGIN, cookie: ctx.cookie },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    let json: T;
    try {
      json = res.json<T>();
    } catch {
      json = undefined as T;
    }
    return { status: res.statusCode, json, body: res.body, res };
  };
}

export async function makeSubject(ctx: TestContext, name = 'Subject A') {
  const call = api(ctx);
  const subject = await call<{ id: string }>('POST', '/api/subjects', { name });
  const topic = await call<{ id: string }>('POST', '/api/topics', {
    subjectId: subject.json.id,
    name: `${name} topic`,
  });
  return { subjectId: subject.json.id, topicId: topic.json.id };
}

export const questionPayloads = (subjectId: string, topicId: string | null = null) => ({
  single: {
    kind: 'single_choice',
    subjectId,
    topicId,
    body: 'Which is a primary colour of light?',
    explanation: 'RGB.',
    options: [
      { body: 'Red', isCorrect: true },
      { body: 'Brown', isCorrect: false },
      { body: 'Beige', isCorrect: false },
    ],
  },
  multi: {
    kind: 'multi_choice',
    subjectId,
    topicId,
    body: 'Select all even numbers.',
    options: [
      { body: '2', isCorrect: true },
      { body: '3', isCorrect: false },
      { body: '4', isCorrect: true },
    ],
  },
  trueFalse: {
    kind: 'true_false',
    subjectId,
    topicId,
    body: 'The Moon is a planet.',
    correctBoolean: false,
  },
  fill: {
    kind: 'fill_gap',
    subjectId,
    topicId,
    body: 'Water is {{blank:h}}2{{blank:o}}.',
    blanks: [
      { key: 'h', acceptedAnswers: ['H'] },
      { key: 'o', acceptedAnswers: ['O', 'oxygen'] },
    ],
  },
});
