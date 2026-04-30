import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  root: 'src/partner',
  base: '/partner/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/partner', import.meta.url))
    }
  },
  build: {
    outDir: '../../dist/partner',
    emptyOutDir: false
  },
  server: {
    port: 3003,
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
      'pinia',
      'vue-i18n',
      '@heroicons/vue/24/outline'
    ]
  },
  clearScreen: false
})
