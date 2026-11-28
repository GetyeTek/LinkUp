import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
      'react': fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      '@linkup-platform/sdk-core': '/packages/core-sdk/src',
      '@linkup/gibi-news': '/packages/gibi-news',
      '@linkup/heaven-academy': '/packages/heaven-academy',
      '@linkup/squad': '/packages/squad'
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'livekit-client', '@livekit/components-react', 'motion', 'motion/react']
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/') ||
            id.includes('\\node_modules\\react\\') ||
            id.includes('\\node_modules\\react-dom\\') ||
            id.includes('\\node_modules\\scheduler\\')
          ) {
            return 'sys.react';
          }
          if (id.includes('packages/gibi-news')) return 'app.discovery.bundle';
          if (id.includes('packages/heaven-academy')) return 'app.academic.bundle';
          if (id.includes('packages/squad')) return 'app.social.bundle';
          if (id.includes('packages/core-sdk')) return 'sys.platform.sdk';
          if (id.includes('node_modules')) return 'sys.vendor';
        }
      }
    }
  }
})