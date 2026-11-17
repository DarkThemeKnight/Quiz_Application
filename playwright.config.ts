import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the production build (API serving apps/web/dist) against the dedicated
 * E2E_DATABASE_URL database, which global-setup wipes, migrates and seeds with a test owner.
 * Prerequisites: `pnpm --filter @recall/web build` and E2E_DATABASE_URL in .env.
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // Uses the locally installed Google Chrome by default (no browser download needed).
    // Set PW_CHANNEL= (empty) to use Playwright's bundled Chromium after `pnpm exec playwright install chromium`.
    ...(process.env.PW_CHANNEL === '' ? {} : { channel: process.env.PW_CHANNEL ?? 'chrome' }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(PORT) },
  },
});
