import { createInterface } from 'node:readline';
import { z } from 'zod';
import { loadEnvFile } from '../config.js';
import { createDatabase, describeDbError, type Database } from '../db/client.js';

/** CLIs only need the database settings, so they validate just those. */
export function openDatabaseFromEnv(): Database {
  loadEnvFile();
  const env = z
    .object({
      DATABASE_URL: z
        .string({ message: 'DATABASE_URL is not set. Copy .env.example to .env and fill it in.' })
        .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgresql://')
        .refine(
          (v) => !/YOUR_|REPLACE_/.test(v),
          'DATABASE_URL still has placeholder values from .env.example',
        ),
      DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
    })
    .safeParse(process.env);
  if (!env.success) fail(env.error.issues.map((i) => i.message).join('\n'));
  return createDatabase({
    databaseUrl: env.data.DATABASE_URL,
    databaseSsl: env.data.DATABASE_SSL,
    databasePoolMax: 2,
  });
}

export function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

export function dbFail(error: unknown): never {
  fail(describeDbError(error));
}

export function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

/** Read a line without echoing it (falls back to plain input when stdin is not a TTY). */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return prompt(question);
  return new Promise((resolve) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}
