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
    /**
     * **不复用**已存在的服务。
     *
     * 之前是 `reuseExistingServer: !process.env.CI`（本地复用，省一次启动）。
     * 但 E2E 服务在**启动时**会清库（clearAllData）—— 复用旧服务就等于
     * **不清库**：上一轮跑剩下的数据（多出来的合作方、订单、库存变动）
     * 会留到下一轮，表现为"某个用例偶发失败"（比如列表里多了一行，
     * 定位器命中多个元素）。
     *
     * 而且旧进程一旦残留（跑崩了、被 kill 了），它会一直占着 3000 端口，
     * 新服务起不来 —— 排查起来非常费时间。
     *
     * 现在每轮都起新服务：数据是干净的，端口占用也会**立刻报错**而不是
     * 悄悄用着旧数据。慢几秒，换来确定性。
     */
    reuseExistingServer: false,
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
