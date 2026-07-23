import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // Full library scans hit TMDB per title and can take several minutes.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
