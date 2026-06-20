import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  timeout: 180_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'iPhone-SE2',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
    {
      name: 'iPhone-12',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'Pixel-5',
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 851 },
        deviceScaleFactor: 2.75,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iPad-Mini',
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'Desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'Desktop-1920',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        // 既定は本番ビルドE2E (next build → next start)。dev のオンデマンド再コンパイルや
        // HMR/SourceMap オーバーヘッドが無く、ページ読込・実行が速く本番と同条件で検証できる。
        // 手早く反復したい時は PLAYWRIGHT_DEV=1 で従来の dev サーバへ切替可能。
        command: process.env.PLAYWRIGHT_DEV
          ? 'pnpm --filter web exec next dev --webpack -p 3001'
          : 'pnpm --filter web exec next build --webpack && pnpm --filter web exec next start -p 3001',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        // 本番ビルドの初回コンパイル時間を吸収する余裕を持たせる。
        timeout: process.env.PLAYWRIGHT_DEV ? 180_000 : 600_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
