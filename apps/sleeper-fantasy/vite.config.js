import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served under /apps/sleeper-fantasy by Valence. `base` must match the mount
// prefix or every hashed asset 404s (the SPA fallback deliberately returns a
// 404 for missing assets rather than serving index.html).
export default defineConfig({
  plugins: [react()],
  base: '/apps/sleeper-fantasy/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
