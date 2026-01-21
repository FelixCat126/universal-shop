import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/test-setup.js'],
    // SQLite不支持高并发，禁用文件级并发
    fileParallelism: false,
    // 每个测试文件内部的测试可以并发
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
