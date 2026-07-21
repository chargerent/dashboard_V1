import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.codex-tmp/playwright-results',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 7_500,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: '.codex-tmp/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'mobile-dashboard',
      grepInvert: /@desktop/,
      use: {
        ...devices['Pixel 7'],
        channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
      },
    },
    {
      name: 'desktop-dashboard',
      grep: /@desktop/,
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/portal/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
