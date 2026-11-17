// Starts the API (serving the built web app) against the E2E database for Playwright.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.E2E_DATABASE_URL) {
  console.error('E2E_DATABASE_URL is not set in .env');
  process.exit(1);
}
// Reset the e2e database before the server starts (also done in global setup for safety).
execFileSync('pnpm', ['--filter', '@recall/api', 'exec', 'tsx', 'test/e2eReset.ts'], {
  stdio: 'inherit',
});

const port = process.env.E2E_PORT ?? '4173';
const child = spawn('pnpm', ['--filter', '@recall/api', 'exec', 'tsx', 'src/server.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: process.env.E2E_DATABASE_URL,
    APP_PORT: port,
    APP_ORIGIN: `http://127.0.0.1:${port}`,
    LOG_LEVEL: 'warn',
  },
});
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
