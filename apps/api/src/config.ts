import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root (apps/api/src → ../../..). Also valid from the bundled dist/ directory. */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const placeholder = (value: string) => /YOUR_|REPLACE_|CHANGE_ME|changeme/i.test(value);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_HOST: z.string().min(1).default('127.0.0.1'),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_ORIGIN: z
    .url({ message: 'APP_ORIGIN must be a URL such as http://127.0.0.1:5173' })
    .transform((v) => new URL(v).origin),
  /** Comma-separated extra origins allowed for state-changing requests (optional). */
  EXTRA_ORIGINS: z.string().default(''),
  DATABASE_URL: z
    .string({ message: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL is required')
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must start with postgresql://')
    .refine(
      (v) => !placeholder(v),
      'DATABASE_URL still contains the placeholder values from .env.example',
    ),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  SESSION_SECRET: z
    .string({ message: 'SESSION_SECRET is required' })
    .min(32, 'SESSION_SECRET must be at least 32 characters (generate with: openssl rand -hex 32)')
    .refine(
      (v) => !placeholder(v),
      'SESSION_SECRET still contains the placeholder value from .env.example',
    ),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  ALLOW_PUBLIC_LISTEN: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Directory of the built web app to serve (production). Defaults to apps/web/dist. */
  WEB_DIST_DIR: z.string().optional(),
});

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  origin: string;
  allowedOrigins: string[];
  databaseUrl: string;
  databaseSsl: 'disable' | 'require' | 'verify-full';
  databasePoolMax: number;
  sessionSecret: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: string;
  webDistDir: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parse configuration from an env-like object. Never includes secret values in errors. */
export function parseConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];
  if (!LOOPBACK.has(e.APP_HOST) && e.ALLOW_PUBLIC_LISTEN !== 'true') {
    problems.push(
      `APP_HOST=${e.APP_HOST} is not a loopback address. Set ALLOW_PUBLIC_LISTEN=true only behind TLS and a firewall (see docs/SECURITY.md).`,
    );
  }
  const httpsOrigin = e.APP_ORIGIN.startsWith('https://');
  const cookieSecure = e.COOKIE_SECURE === 'auto' ? httpsOrigin : e.COOKIE_SECURE === 'true';
  if (
    e.NODE_ENV === 'production' &&
    !cookieSecure &&
    !LOOPBACK.has(new URL(e.APP_ORIGIN).hostname)
  ) {
    problems.push('Production on a non-loopback origin requires HTTPS (secure cookies).');
  }
  if (problems.length) throw new ConfigError(problems);
  const extra = e.EXTRA_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  return {
    env: e.NODE_ENV,
    host: e.APP_HOST,
    port: e.APP_PORT,
    origin: e.APP_ORIGIN,
    allowedOrigins: [e.APP_ORIGIN, ...extra],
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    cookieSecure,
    trustProxy: e.TRUST_PROXY === 'true',
    logLevel: e.LOG_LEVEL,
    webDistDir: e.WEB_DIST_DIR ? resolve(e.WEB_DIST_DIR) : resolve(REPO_ROOT, 'apps/web/dist'),
  };
}

/** Load the repo-root .env (if present) without overriding real environment variables. */
export function loadEnvFile(): void {
  const path = resolve(REPO_ROOT, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(): AppConfig {
  loadEnvFile();
  return parseConfig(process.env);
}
