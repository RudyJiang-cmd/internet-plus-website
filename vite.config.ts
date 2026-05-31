import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  server: {
    allowedHosts: [
      '.loca.lt',
      '.trycloudflare.com',
    ],
    proxy: {
      '/api': {
        target: 'http://43.129.24.82:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dunhuang: resolve(__dirname, 'dunhuang.html'),
      },
    },
  },
  plugins: [
    react(),
    tsconfigPaths()
  ],
})
