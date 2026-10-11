import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The Instagram downloader runs in server/index.js.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
