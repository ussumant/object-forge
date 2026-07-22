import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'IMG3D_FAKE_PROVIDER=1 IMG3D_PORT=4058 npm run dev -w @img3d/server',
      port: 4058,
      reuseExistingServer: false,
    },
    {
      command: 'IMG3D_API_TARGET=http://127.0.0.1:4058 npm run dev -w @img3d/web -- --host 127.0.0.1 --port 4173',
      port: 4173,
      reuseExistingServer: false,
    }
  ],
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: '**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      testMatch: '**/responsive.spec.ts',
      use: { ...devices['iPhone 13'], browserName: 'chromium', channel: 'chrome', viewport: { width: 393, height: 852 } },
    }
  ],
});
