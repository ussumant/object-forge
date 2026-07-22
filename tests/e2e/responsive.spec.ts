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
