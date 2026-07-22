import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const workspace = process.cwd();
const root = process.env.IMG3D_ROOT_DIR;
if (!root) throw new Error('IMG3D_ROOT_DIR is not configured by the creator service.');

const output = resolve(workspace, readArgument('--output', 'output/playwright/preview.png'));
const width = Number.parseInt(readArgument('--width', '1200'), 10);
const height = Number.parseInt(readArgument('--height', '900'), 10);
const route = readArgument('--route', '/');
if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 320) {
  throw new Error('Capture width and height must be numeric and at least 320 pixels.');
}
if (!output.startsWith(`${workspace}/`)) throw new Error('Capture output must stay inside the run workspace.');

const [{ createServer }, { chromium }] = await Promise.all([
  import(pathToFileURL(resolve(root, 'node_modules/vite/dist/node/index.js')).href),
  import(pathToFileURL(resolve(root, 'node_modules/playwright/index.mjs')).href),
]);

const browserCandidates = [
  process.env.IMG3D_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
let executablePath;
for (const candidate of browserCandidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // Try the next installed browser.
  }
}
if (!executablePath) throw new Error('No supported local Chrome or Chromium executable was found.');

await mkdir(dirname(output), { recursive: true });
const server = await createServer({
  root: workspace,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0];
  if (!baseUrl) throw new Error('The local preview server did not expose a URL.');
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      failures.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  await page.goto(new URL(route, baseUrl).href, { waitUntil: 'networkidle' });
  await page.screenshot({ path: output, fullPage: false });
  if (failures.length) throw new Error(`Browser verification failed: ${failures.join(' | ')}`);
  process.stdout.write(`${output}\n`);
} finally {
  await browser?.close();
  await server.close();
}
