import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/LinkUp/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('packages/gibi-news')) {
            return 'module-gibi-news';
          }
          if (id.includes('packages/heaven-academy')) {
            return 'module-heaven-academy';
          }
          if (id.includes('packages/squad')) {
            return 'module-squad';
          }
          if (id.includes('node_modules')) {
            return 'vendor-core';
          }
        }
      }
    }
  }
})