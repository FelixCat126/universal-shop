import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] }
    },
    {
      name: 'desktop-chrome',
      use: { viewport: { width: 1280, height: 800 } }
    }
  ],
  webServer: {
    command: 'node tests/e2e/start-test-server.mjs',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL_TEST: process.env.DATABASE_URL_TEST || 'postgres://shop:shop@127.0.0.1:5432/shop_test',
      JWT_SECRET: 'e2e-jwt-secret-key-for-testing-only-32-chars',
      JWT_ADMIN_SECRET: 'e2e-admin-secret-key-for-testing-only',
      JWT_PARTNER_SECRET: 'e2e-partner-secret-key-for-testing-only',
      CAPTCHA_SECRET: 'e2e-captcha-secret-key-for-testing-only',
      RATE_LIMIT_DISABLED: '1'
    }
  }
})
