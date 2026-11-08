// How long a supervisor waits on a slow connection and a slow processor (UI/UX plan, slice 4.2).
//   npm run load       (needs Microsoft Edge; builds the app and starts a demo API and the preview itself)
//
// This is EMULATION: Chrome's network throttle (Slow 3G: 500 kbit/s and 400 ms; Fast 3G: 1.6 Mbit/s and 150 ms) and a 4x slower
// processor on this computer. It is not a 2 GB phone on a real mobile network, and says so wherever the numbers are quoted. It tells
// us whether a blank wait is long enough (over 1 s) to be worth a skeleton or a first-paint shell, and where it comes from.
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Page, type BrowserContext } from 'playwright-core'
import { startDemoApi } from '../packages/server/src/demo.js'
import { CREDS } from '../packages/server/test/helpers.js'

const API_PORT = Number(process.env.LOAD_API_PORT ?? 8795)
const WEB = 'http://localhost:4173'
const PROFILES = [
  { name: 'Slow 3G, 4x slower processor', latency: 400, down: (500 * 1024) / 8, up: (400 * 1024) / 8, cpu: 4 },
  { name: 'Fast 3G, 4x slower processor', latency: 150, down: (1600 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
]

function killTree(p: ChildProcess) {
  try {
    if (!p.pid) return
    if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' })
    else process.kill(-p.pid)
  } catch { /* already gone */ }
}
async function waitFor(url: string, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)) }
  throw new Error(`${url} did not come up`)
}

async function throttle(ctx: BrowserContext, page: Page, p: (typeof PROFILES)[number]) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
}

const ms = (n: number | null) => (n === null ? 'never' : `${Math.round(n)} ms`)
const demo = await startDemoApi({ port: API_PORT, origins: [WEB, 'http://127.0.0.1:4173'] })
let preview: ChildProcess | null = null
let exit = 0
try {
  console.log('building the app...')
  execSync('npm run build -w @isocode/web', { stdio: 'ignore', env: { ...process.env, VITE_API_BASE: `http://127.0.0.1:${API_PORT}` } })
  preview = spawn('npm', ['run', 'preview', '-w', '@isocode/web'], { shell: true, stdio: 'ignore', detached: process.platform !== 'win32' })
  await waitFor(`${WEB}/precache.json`)
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })

  console.log(`\nLoad times (${new Date().toISOString().slice(0, 10)}, demo data, EMULATED slow network and processor, Edge ${browser.version()}):`)
  for (const p of PROFILES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await ctx.addInitScript(() => { try { window.localStorage.setItem('orders.lang', 'en') } catch { /* private window */ } })
    const page = await ctx.newPage()
    await throttle(ctx, page, p)
    let bytes = 0
    page.on('response', async (r) => { try { bytes += (await r.body()).length } catch { /* redirects, cancelled */ } })

    // 1. first ever visit (nothing stored): when anything is drawn, and when the sign-in is usable
    const t0 = Date.now()
    await page.goto(`${WEB}/login`, { waitUntil: 'commit' })
    if (process.env.SHELL_SHOT && p.latency === 400) { await page.waitForTimeout(1800); await page.screenshot({ path: process.env.SHELL_SHOT }) }   // what the screen shows while the app is still downloading
    await page.waitForSelector('#boot, button', { timeout: 120_000, state: 'attached' })
    const shellAt = Date.now() - t0   // the ring or the sign-in, whichever is there first
    await page.waitForSelector('button', { timeout: 120_000 })
    const usable = Date.now() - t0
    const shellGone = (await page.locator('#boot').count()) === 0
    const paint = await page.evaluate(() => ({ fp: performance.getEntriesByName('first-paint')[0]?.startTime ?? null, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null }))
    console.log(`\n${p.name}`)
    console.log(`  first visit, sign-in screen: first paint ${ms(paint.fp)}, first content ${ms(paint.fcp)}, ring or sign-in on screen at ${ms(shellAt)}, sign-in button there at ${ms(usable)}, ring gone after mount: ${shellGone}; ${Math.round(bytes / 1024)} KB downloaded`)

    // 2. sign in as the supervisor: how long the "Loading" state shows before the list
    await page.click('button:has-text("Supervisor")')
    await page.fill('input[type=tel]', CREDS.phone)
    await page.fill('input[type=password]', CREDS.pin)
    if (process.env.LIST_SHOT && p.latency === 400) await page.route('**/api/my/stages', async (r) => { await new Promise((res) => setTimeout(res, 6000)); await r.continue() })   // hold the list back so the wait can be photographed
    const t1 = Date.now()
    await page.click('button:has-text("Sign in") >> nth=-1')
    let loadingSeen: number | null = null
    if (process.env.LIST_SHOT && p.latency === 400) { await page.waitForSelector('.skeletons', { state: 'attached', timeout: 120_000 }).catch(() => {}); await page.waitForTimeout(500); await page.screenshot({ path: process.env.LIST_SHOT }) }   // what shows while the list loads
    const watch = page.waitForSelector('.stage', { timeout: 120_000 })
    const poll = (async () => { for (let i = 0; i < 600 && loadingSeen === null; i++) { if (await page.locator('[role=status], .loading').first().isVisible().catch(() => false)) loadingSeen = Date.now() - t1; await page.waitForTimeout(100) } })()
    await watch
    const listAt = Date.now() - t1
    void poll
    console.log(`  sign-in tap to the list of stages: ${ms(listAt)}`)

    // 3. a later visit (the app is stored by the service worker)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForTimeout(3000)   // let it finish storing the app
    const t2 = Date.now()
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('.stage', { timeout: 120_000 })
    const warm = Date.now() - t2
    const warmPaint = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null)
    console.log(`  a later visit (app stored): first content ${ms(warmPaint)}, list of stages at ${ms(warm)}`)
    await ctx.close()
  }
  await browser.close()
} catch (e) {
  console.error(e)
  exit = 1
} finally {
  if (preview) killTree(preview)
  await demo.close?.()
}
process.exit(exit)
