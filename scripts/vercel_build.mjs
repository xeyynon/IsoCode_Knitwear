#!/usr/bin/env node
// Builds the app for Vercel as Build Output API v3 (.vercel/output), so nothing depends on Vercel guessing how to compile a
// TypeScript workspace:
//   static/             the web app (Vite build), same address as the API
//   functions/api.func  the whole API bundled into one ES module (esbuild), a Node.js function
//   config.json         /api/* to the function, files as they are, every other path to index.html (the app's own router)
// On a PRODUCTION deploy only, it then brings the database up to date (MIGRATE_DATABASE_URL, the table owner) and, with
// SEED_DEMO=1, loads the demo data into an empty database (DATABASE_URL, the app's own login). A preview never touches the schema.
//   npm run build:vercel        (Vercel runs it as the build command; it also works locally and skips the database step)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { scriptDir } from './repoRoot.mjs'

// The folder above this script, not git: Vercel's build has no .git folder.
const root = path.resolve(scriptDir(import.meta.url), '..')
const out = path.join(root, '.vercel', 'output')
const env = process.env
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
/** @param {string[]} args @param {Record<string, string>} [extraEnv] */
const run = (args, extraEnv = {}) => execFileSync(npm, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extraEnv }, shell: process.platform === 'win32' })

fs.rmSync(out, { recursive: true, force: true })

// 1. The web app. Same address as the API, said out loud (see vite.config.ts).
// The demo logins on the sign-in screen go with the demo clock: a deployment with DEMO_TODAY is the review demo, any other is not.
run(['run', 'build', '-w', '@isocode/web'], { VITE_API_BASE: env.VITE_API_BASE || 'same-origin', VITE_DEMO_ACCESS: env.VITE_DEMO_ACCESS ?? (env.DEMO_TODAY ? '1' : '') })
fs.cpSync(path.join(root, 'packages', 'web', 'dist'), path.join(out, 'static'), { recursive: true })

// 2. The API, one file. pg can use a native driver if one is installed; it is not, and must not be bundled.
const fn = path.join(out, 'functions', 'api.func')
fs.mkdirSync(fn, { recursive: true })
await build({
  entryPoints: [path.join(root, 'packages', 'server', 'src', 'vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg-native'],
  // Some dependencies are CommonJS and call require(): give the ES module one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
})
fs.writeFileSync(path.join(fn, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60,
}, null, 2))

// 3. Routing and headers.
const security = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',          // a buyer link's token is in the #fragment, never sent; this keeps the path private too
  'x-frame-options': 'DENY',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(self)',
  'strict-transport-security': 'max-age=31536000',
}
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers: security, continue: true },
    { src: '/api/(.*)', dest: '/api' },
    { src: '/sw\\.js', headers: { 'cache-control': 'no-cache' }, continue: true },
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2))
console.log(`vercel_build: wrote ${path.relative(root, out)} (static app, one API function)`)

// 4. The database, on a production deploy only.
if (env.VERCEL_ENV === 'production') {
  if (env.MIGRATE_DATABASE_URL) {
    run(['run', 'migrate'], { DATABASE_URL: env.MIGRATE_DATABASE_URL })
  } else {
    console.log('vercel_build: MIGRATE_DATABASE_URL is not set, so the schema was not checked. Run npm run migrate by hand.')
  }
  if (env.SEED_DEMO === '1') run(['run', 'seed:demo', '--', '--if-empty'])
} else {
  console.log(`vercel_build: not a production deploy (${env.VERCEL_ENV ?? 'local'}): database left alone`)
}
