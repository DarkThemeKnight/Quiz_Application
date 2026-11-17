import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Fields in the same form row must line up even when only some have a hint line underneath.
test('form controls in the same row share top edge and height', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  const rows = [
    ['Display name', 'Theme', 'Default mode'],
    ['Current password', 'New password', 'Repeat new password'],
  ];
  for (const labels of rows) {
    const boxes = await Promise.all(
      labels.map((l) => page.getByLabel(l, { exact: true }).boundingBox()),
    );
    const tops = boxes.map((b) => Math.round(b?.y ?? -1));
    const heights = boxes.map((b) => Math.round(b?.height ?? -1));
    expect(new Set(tops).size, `tops for ${labels.join(', ')}: ${tops}`).toBe(1);
    expect(new Set(heights).size, `heights for ${labels.join(', ')}: ${heights}`).toBe(1);
  }
});
