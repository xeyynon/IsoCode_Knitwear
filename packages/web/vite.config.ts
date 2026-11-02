import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_* values are baked into the bundle at build time. A missing one silently points a
  // production build at the wrong place, so refuse to build instead.
  if (mode === 'production' && !env.VITE_API_BASE) {
    throw new Error('VITE_API_BASE is not set. Set it to the API address (for example https://api.example.com) and build again.')
  }
  return {
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  }
})
