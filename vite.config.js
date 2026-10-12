import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pre-bundle lazily imported deps so the dev server doesn't reload the page
  // the first time a tool imports them.
  optimizeDeps: { include: ['heic2any', 'qrcode', 'diff', 'fflate', 'pdfjs-dist'] },
  server: {
    // The video downloader runs in server/index.js.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
