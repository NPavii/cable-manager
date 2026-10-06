import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' и формат iife обязательны: standalone-приложение грузится через file://
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
})
