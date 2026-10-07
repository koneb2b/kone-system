import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy to local wrangler dev server during development
    proxy: {
      '/v1': 'http://localhost:8787',
    },
  },
})
