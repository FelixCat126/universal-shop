import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * 测试矩阵：当前保留的回归覆盖（PostgreSQL 实库）
 *   - tests/api/security.test.js              止血鉴权/CORS/CSP/错误响应
 *   - tests/api/inputValidation.test.js       Joi 校验 / 上传魔法字节 / 游客密码
 *   - tests/api/securityHardening.test.js     验证码 / 登录强制守卫 / 审计日志
 *   - tests/integration/concurrencySafety.test.js  库存原子 / 支付幂等 / 默认地址原子
 *
 * 老的与现行 schema/接口已脱节的旧测试已删除，避免误报。
 */

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/test-setup.js'],
    exclude: ['node_modules/**', 'dist/**'],
    // PostgreSQL 支持高并发，但测试间共享同一个数据库需要串行避免互相 TRUNCATE
    fileParallelism: false,
    sequence: {
      concurrent: false
    },
    // 增加超时时间
    testTimeout: 30000,
    hookTimeout: 30000,
  coverage: {
    provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'public/',
        'scripts/',
        '**/*.config.js',
        '**/*.config.ts',
        'database/',
        '*.sh',
        'package.sh',
        'setup.js',
        'start-https-production.js',
        'src/server/seeds/',
        'src/server/migrations/',
        'nodemon.json'
      ],
      include: [
        'src/server/**/*.js',
        'src/portal/**/*.js',
        'src/portal/**/*.vue',
        'src/admin/**/*.js',
        'src/admin/**/*.vue'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 75,
          lines: 80,
          statements: 80
        },
        'src/server/controllers/': {
          branches: 75,
          functions: 80,
          lines: 85,
          statements: 85
        },
        'src/server/models/': {
          branches: 80,
          functions: 85,
          lines: 90,
          statements: 90
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), './src'),
      '@server': resolve(process.cwd(), './src/server'),
      '@portal': resolve(process.cwd(), './src/portal'),
      '@admin': resolve(process.cwd(), './src/admin'),
      '@tests': resolve(process.cwd(), './tests')
    }
  }
})
