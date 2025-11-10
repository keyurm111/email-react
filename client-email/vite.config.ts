import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 7026,
    proxy: {
      '/api': {
        target: 'http://localhost:7027',
        changeOrigin: true,
        secure: false,
      },
      '/tracker': {
        target: 'http://localhost:7027',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
