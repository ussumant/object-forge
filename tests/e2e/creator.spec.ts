import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';

const fixturePath = resolve('output/playwright/reference-fixture.png');
const videoFixturePath = resolve('output/playwright/orbit-fixture.mp4');
const execFileAsync = promisify(execFile);

test.beforeAll(async () => {
  await mkdir(resolve('output/playwright'), { recursive: true });
  await sharp({ create: { width: 900, height: 700, channels: 3, background: '#c8c4b9' } })
    .composite([
      { input: Buffer.from('<svg width="520" height="340"><rect x="20" y="50" width="480" height="250" rx="35" fill="#34362f"/><circle cx="295" cy="175" r="90" fill="#d4d2c8"/><circle cx="295" cy="175" r="55" fill="#20221d"/><rect x="80" y="20" width="110" height="65" rx="12" fill="#ef5f35"/></svg>'), left: 190, top: 170 },
    ])
    .png()
    .toFile(fixturePath);
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=640x480:rate=12', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    videoFixturePath,
  ]);
});

test('video capture selects views, confirms text, and completes a guided build', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const name = `Guided bottle ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('What are we rebuilding?').fill(name);
  await page.getByRole('button', { name: 'Create object project' }).click();
  await page.locator('input[accept^="video/"]').setInputFiles(videoFixturePath);
  await expect(page.getByRole('heading', { name: 'These are the views we’ll use' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByPlaceholder('e.g. POCARI SWEAT').fill('POCARI SWEAT');
  await page.getByRole('button', { name: /Use \d+ selected views/i }).click();
  await expect(page.getByText('Capture pack ready')).toBeVisible();
  await page.getByRole('button', { name: 'Create 3D model' }).click();
  await expect(page.getByText(/finish · Codex/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/active model ready/i)).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `output/playwright/studio-${test.info().project.name}.png`, fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test('capture, draft, finish, refine, reload, and export', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const name = `Fixture camera ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('What are we rebuilding?').fill(name);
  await page.getByRole('button', { name: 'Create object project' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  const chooser = page.locator('input[accept*="image/png"]');
  await chooser.setInputFiles(fixturePath);
  await expect(page.getByRole('heading', { name: 'Isolate the object' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to capture pack' }).click();
  await expect(page.getByText('conditional capture')).toBeVisible();
  await page.getByText('I accept inferred geometry for unseen sides or the underside.').click();
  await page.getByRole('button', { name: 'Create 3D model' }).click();
  await expect(page.getByText(/finish · Codex/i)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/Directed refinement/).fill('Make the shutter button larger.');
  await page.getByRole('button', { name: 'Create refinement run' }).click();
  await expect(page.getByText(/refine · Codex/i)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText(/active model ready/i)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export' }).click();
  expect((await download).suggestedFilename()).toContain('threejs.zip');
  expect(consoleErrors).toEqual([]);
});
