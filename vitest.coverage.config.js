import { defineConfig } from 'vitest/config'
import baseConfig from './vitest.config.js'

/**
 * 后端覆盖率专用配置：只跑需要真实 PG 的 API/集成测试。
 * Vue 组件测试在 vitest.vue.config.js（happy-dom）下单独执行，避免 node 环境下 localStorage 缺失。
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['tests/api/**/*.test.js', 'tests/integration/**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**', 'tests/vue/**'],
    coverage: {
      ...baseConfig.test.coverage,
      include: ['src/server/**/*.js']
    }
  }
})
