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
    emptyOutDir: false,
    rollupOptions: {
      output: {
        /**
         * 将 ECharts / Element Plus / Vue 生态拆成独立 vendor，减少首屏主包并提高缓存命中。
         *
         * 注意：这里必须用「路径段精确匹配」而不是 includes 模糊匹配。
         * 早期用 id.includes('node_modules/vue') 会把 node_modules/vue-echarts、
         * node_modules/@vue/* 一并归入 vendor-vue，而 vue-echarts 依赖 echarts
         * （被分到 vendor-echarts），形成 vendor-vue ↔ vendor-echarts 交叉依赖；
         * Rollup 人工分块会绕过其依赖分析，最终产物在浏览器里抛
         * "Cannot access 'xxx' before initialization"（TDZ），整个 SPA 白屏。
         *
         * 判据：id 形如 /abs/path/node_modules/<pkg>/...，取 <pkg> 精确比较。
         */
        manualChunks (id) {
          const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)
          if (!m) return undefined
          const pkg = m[1]
          if (pkg === 'echarts' || pkg === 'vue-echarts' || pkg === 'zrender') {
            return 'vendor-echarts'
          }
          if (pkg === 'element-plus' || pkg === '@element-plus/icons-vue') {
            return 'vendor-element-plus'
          }
          if (pkg === 'vue' || pkg === '@vue/runtime-core' || pkg === '@vue/runtime-dom' ||
              pkg === '@vue/shared' || pkg === '@vue/reactivity' || pkg === '@vue/compiler-sfc' ||
              pkg === 'pinia' || pkg === 'vue-i18n' || pkg === 'vue-router' || pkg === 'axios') {
            return 'vendor-vue'
          }
          return undefined
        }
      }
    }
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
