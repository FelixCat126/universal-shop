import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  root: './src/portal',
  base: '/portal/',  // 修复：添加/portal/前缀
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/portal')
    }
  },
  build: {
    outDir: '../../dist/portal',
    emptyOutDir: false
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
