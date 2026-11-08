// Renders the app's home-screen icons once: node scripts/make_icons.mjs  (needs Microsoft Edge; E2E_BROWSER overrides the channel).
// Plain by design: a flat rounded square in the action colour (--accent) with one white tick, no gradient, no edge bar. The PNGs are
// committed under packages/web/public/icons, so a build never needs a browser; run this only to change the icon.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'web', 'public', 'icons')
const ACCENT = '#6E5BB1'   // --accent in packages/design/tokens.css
const tick = '<polyline points="150,268 226,344 366,176" fill="none" stroke="#FFFFFF" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>'
// "any": rounded corners on a transparent ground. "full": a square to the edges, for the maskable icon (the phone cuts its own shape; the
// tick stays inside the middle 80%) and for iOS, which rounds the apple-touch-icon itself.
const svg = (/** @type {boolean} */ rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%"><rect width="512" height="512" ${rounded ? 'rx="112" ' : ''}fill="${ACCENT}"/>${tick}</svg>`

/** @type {[string, number, boolean][]} name, side in pixels, rounded corners */
const files = [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['icon-maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })
try {
  for (const [name, size, rounded] of files) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(rounded)}</body></html>`)
    writeFileSync(path.join(OUT, name), await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
    await page.close()
    console.log(`wrote ${name}`)
  }
} finally { await browser.close() }
