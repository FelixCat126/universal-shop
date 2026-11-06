/**
 * 前端 Vue 单元测试配置：
 *   - environment: happy-dom（无需真实数据库）
 *   - 不挂载 tests/setup/test-setup.js（避免连 PG）
 *   - 仅扫描 tests/vue/**
 *   - 别名与主 vitest.config.js 保持一致
 */
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/vue/**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 10000,
    /**
     * element-plus 要**内联**（走 vite 管线），否则它内部的
     * `import 'element-plus/theme-chalk/el-message.css'` 这类样式导入
     * 会落到 node 的 ESM 加载器上 → "Unknown file extension .css" → 整个测试文件起不来。
     *
     * 起因：管理端改成了 Element Plus 样式按需引入，组件里出现了 CSS import。
     */
    server: {
      deps: {
        inline: ['element-plus']
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), './src'),
      '@server': resolve(process.cwd(), './src/server'),
      '@portal': resolve(process.cwd(), './src/portal'),
      '@admin': resolve(process.cwd(), './src/admin'),
      '@partner': resolve(process.cwd(), './src/partner'),
      '@tests': resolve(process.cwd(), './tests')
    }
  }
})
