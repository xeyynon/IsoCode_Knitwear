import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_* values are baked into the bundle at build time. A missing one silently points a
  // production build at the wrong place, so refuse to build instead.
  if (command === 'build' && mode === 'production' && !env.VITE_API_BASE) {
    throw new Error('VITE_API_BASE is not set. Set it to the API address (for example https://api.example.com) and build again.')
  }
  return {
    plugins: [
      react(),
      {
        // The service worker reads this list to keep every screen (and its fonts) available with no signal.
        // A browser installs a new worker (and so precaches) only when the bytes of sw.js change,
        // so each build ships sw.js with a cache name of its own; activate then drops the old build.
        name: 'precache-list',
        apply: 'build',
        generateBundle(_options, bundle) {
          // Fonts too (woff2 only: the .woff files the font CSS also names are for browsers that
          // cannot read woff2, which no browser able to run the app is), so Tamil has a font offline.
          const files = Object.keys(bundle).filter((f) => /\.(js|css|woff2)$/.test(f))
          this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) })
          const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12)
          const sw = readFileSync(fileURLToPath(new URL('./public/sw.js', import.meta.url)), 'utf8')
          this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw.replace(/const CACHE = '[^']+'/, `const CACHE = 'app-shell-${version}'`) })
        },
      },
    ],
    server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
    preview: { port: 4173 },
  }
})
