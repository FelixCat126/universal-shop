import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * 开发与生产 base 策略：
 * - `vite dev`：`base === '/'`。若开发时也设 `/admin/`，浏览器会请求 `/admin/@fs/...`、`/admin/node_modules/.vite/deps/...`，
 *   Vite 实际只在根路径提供这些模块 → 504 Outdated Optimize Dep、图表与动态路由 chunk 加载失败。
 * - `vite build` / `vite preview`：`/admin/` 与 Express 线上静态挂载一致。
 */
function viteAdminBase () {
  const argv = process.argv
  if (argv.includes('build') || argv.includes('preview')) return '/admin/'
  return '/'
}

export default defineConfig({
  plugins: [vue()],
  root: 'src/admin',
  base: viteAdminBase(),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src/admin', import.meta.url))
    }
  },
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: false
  },
  server: {
    port: 3002,
    proxy: {
      '^/api/(?!.*\\.(js|ts|vue|css|map)$)': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    force: process.env.NODE_ENV === 'development',
    include: [
      'vue',
      'vue-router',
      'vue-i18n',
      'pinia',
      'axios',
      'element-plus',
      '@element-plus/icons-vue',
      'vue-echarts',
      'echarts/core',
      'echarts/renderers',
      'echarts/charts',
      'echarts/components'
    ]
  },
  clearScreen: false
})
