import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  root: 'src/admin',
  base: '/admin/',
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
      '@element-plus/icons-vue'
    ]
  },
  clearScreen: false
})