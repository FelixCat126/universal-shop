import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'inject-portal-build-meta',
      transformIndexHtml () {
        return [
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: {
              name: 'portal-build-at',
              content: new Date().toISOString()
            }
          }
        ]
      }
    }
  ],
  root: './src/portal',
  base: '/portal/',  // 修复：添加/portal/前缀
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/portal')
    }
  },
  build: {
    outDir: '../../dist/portal',
    /**
     * 清空**自己这个**目录。
     *
     * 之前是 false（没写原因），结果每次构建的**旧 chunk 都留在磁盘上**：
     * dist/portal 一度堆到 4.5MB（当前构建其实只有约 800KB），
     * 多出来的 3.7MB 会被打进部署包、也会一直躺在服务器上（每部署一次多一批）。
     *
     * 三个端的 outDir 各自独立（dist/portal、dist/admin、dist/partner），
     * 所以清空一个不影响另两个 —— 可以放心开。
     * Vite 对"outDir 在 root 之外"默认**不**清，必须显式写 true。
     */
    emptyOutDir: true
  },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '^/api/(?!.*\\.(js|ts|vue|css|map)$)': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    },
    watch: { usePolling: true, interval: 100 }
  },
  optimizeDeps: {
    force: process.env.NODE_ENV === 'development',
    include: [
      'vue',
      'vue-router',
      'vue-i18n',
      'pinia',
      'axios',
      '@heroicons/vue/24/outline'
    ]
  },
  clearScreen: false
})
