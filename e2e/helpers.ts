import { expect, type Page } from '@playwright/test';

// Throwaway credentials created by apps/api/test/e2eReset.ts in the dedicated e2e database.
export const E2E_USER = process.env.E2E_USERNAME ?? 'e2e-owner';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password-not-secret';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(E2E_USER);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).not.toHaveURL(/login/);
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}
