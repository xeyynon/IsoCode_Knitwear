import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { csp } from '../../scripts/csp.mjs'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_* values are baked into the bundle at build time. A missing one silently points a
  // production build at the wrong place, so refuse to build instead.
  if (command === 'build' && mode === 'production' && !env.VITE_API_BASE) {
    throw new Error('VITE_API_BASE is not set. Set it to the API address (for example https://api.example.com), or to same-origin when the API is served from the same address as the app, and build again.')
  }
  // "same-origin" is said out loud rather than left empty, so an empty value is still a mistake: the app then calls /api/... on its own address.
  const sameOrigin = env.VITE_API_BASE === 'same-origin'
  return {
    ...(sameOrigin ? { define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('') } } : {}),
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
          // The manifest, the theme script and the home-screen icons (public/) are copied to the output after the bundle is made, so they are not in it: listed here from the folder.
          // They are part of the build's fingerprint, so a changed icon ships a new worker.
          const pub = fileURLToPath(new URL('./public/', import.meta.url))
          files.push('manifest.webmanifest', 'theme-init.js', ...readdirSync(pub + 'icons').filter((f) => f.endsWith('.png')).sort().map((f) => `icons/${f}`))
          this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) })
          const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12)
          const sw = readFileSync(fileURLToPath(new URL('./public/sw.js', import.meta.url)), 'utf8')
          this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw.replace(/const CACHE = '[^']+'/, `const CACHE = 'app-shell-${version}'`) })
        },
      },
    ],
    // API_TARGET lets a second session run its own demo API on another port (two sessions on one machine fight over 8787).
    server: { port: 5173, proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' } },
    // The preview server (the browser tests, npm run e2e) sends the policy the hosted build sends, so a violation shows up before a deploy.
    preview: { port: 4173, headers: { 'Content-Security-Policy': csp({ localApi: true }) } },
  }
})
