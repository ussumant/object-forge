import { expect, test } from '@playwright/test';

test('library has a clean initial state at the configured viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByText('Object Forge')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Give a virtual object/i })).toBeVisible();
  await page.screenshot({ path: `output/playwright/library-${test.info().project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('guided video entry remains usable at the configured viewport', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.getByLabel('What are we rebuilding?').fill(`Responsive bottle ${Date.now()}`);
  await page.getByRole('button', { name: 'Create object project' }).click();
  if ((page.viewportSize()?.width ?? 1440) <= 840) {
    await page.getByRole('button', { name: /Evidence/i }).click();
  }
  await expect(page.getByRole('button', { name: 'Upload object video' }).first()).toBeVisible();
  await page.screenshot({ path: `output/playwright/video-entry-${testInfo.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});
