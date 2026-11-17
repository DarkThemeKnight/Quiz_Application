import { expect, test } from '@playwright/test';
import { noHorizontalScroll, signIn } from './helpers';

test('core pages fit a phone screen and use the bottom navigation', async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  for (const path of [
    '/',
    '/practice',
    '/bank',
    '/bank/new',
    '/history',
    '/insights',
    '/library',
    '/settings',
    '/bank/import',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
  }
  await nav.getByRole('link', { name: 'Bank' }).click();
  await expect(page).toHaveURL(/\/bank$/);
});
