import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
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
  plugins: [
    vue(),
    /**
     * Element Plus **按需引入**。
     *
     * 原来 main.js 里 `app.use(ElementPlus)` 把整库（1MB+）打进了首屏主包，
     * 外加 `import * as ElementPlusIconsVue` 把 290 个图标全注册了一遍。
     * 改按需后：模板里用到的组件自动按需引入，图标各文件本来就已按需 import。
     *
     * importStyle: false —— 样式仍走 main.js 里的整包 CSS（避免 JS API
     * （ElMessage 等）样式丢失）；按需引入的组件样式与整包 CSS 是同一批文件，
     * 打包时会去重，不会变大。
     */
    Components({
      resolvers: [ElementPlusResolver({ importStyle: false })],
      dts: false
    })
  ],
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
          /**
           * element-plus / 图标**不**再人工合并成一个大块。
           *
           * 合并的后果：那个块包含所有用到的组件（~950KB），而登录页就要用
           * ElInput/ElButton —— 于是**首屏就得把整块下完**，路由懒加载的意义全没了。
           * 不合并后 Rollup 会按「谁用谁带」自然分包：登录页只带输入框/按钮，
           * 商品页才带表格/上传器，各页各下各的。
           */
          if (pkg === 'element-plus' || pkg === '@element-plus/icons-vue') {
            return undefined
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
