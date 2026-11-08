// Runs axe-core on every screen, at a phone (390x844, touch) and a desktop (1280x900) size, in Edge.
//
//   DEMO_DATA=fixture npm run dev:api                    (terminal 1)
//   npm run dev -w @isocode/web        (terminal 2)
//   npm run a11y                       (terminal 3)
//
// It fails (exit code 1) on any SERIOUS or CRITICAL violation, and prints the rest (moderate and minor) grouped by
// screen. The supervisor screens are checked in English and in Tamil. It uses the demo data and changes nothing
// that stays: the buyer link it needs is cancelled again at the end, and no update is ever sent.
//
// axe cannot judge everything (reading order, whether an alt text is useful, how a screen reader sounds). A clean
// run is a floor, not a pass: still try the screens with NVDA or TalkBack (a manual check).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = process.env.WEB ?? 'http://localhost:5173'
// Optional: a different API than the one the web app proxies to (API=http://127.0.0.1:8788). The demo API's sign-in
// lockout runs on its fixed clock and never lifts, so a spare API is the way out of a locked one.
const API = process.env.API
const MERCH = { email: 'm@example.test', password: 'correct horse battery' }
const SUP = { phone: '98765 43210', pin: '4321' }
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1280, height: 900 } },
} as const
type Device = keyof typeof VIEWPORTS

interface Node { target: string; summary: string }
interface Finding { screen: string; id: string; impact: string; help: string; helpUrl: string; nodes: Node[] }
const findings: Finding[] = []
// When WEB is a preview server (vite preview) the app's Content-Security-Policy is enforced, and a blocked load is reported here.
const cspViolations: string[] = []
let screens = 0

async function up(): Promise<void> {
  try { if ((await fetch(`${WEB}/api/health`)).ok) return } catch { /* handled below */ }
  console.error(`The app is not running at ${WEB}. Start it first:\n  DEMO_DATA=fixture npm run dev:api\n  npm run dev -w @isocode/web`)
  process.exit(2)
}

/** Run axe on what is on screen now. WCAG 2.0 to 2.2 A and AA plus axe's best-practice rules; nothing is switched off. */
async function check(page: Page, screen: string, only?: string): Promise<void> {
  await page.waitForTimeout(400)   // transitions and fonts settle, so contrast is measured on the final colours
  // Evaluated through the debugging channel, not as an inline <script>: the app's Content-Security-Policy (when WEB is a preview server) rightly blocks an inline script.
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE)
  const result = await page.evaluate(async (only) => {
    const axe = (window as unknown as { axe: { run: (c: Document | object, o: object) => Promise<{ violations: { id: string; impact: string | null; help: string; helpUrl: string; nodes: { target: unknown[]; failureSummary?: string }[] }[] }> } }).axe
    return axe.run(only ? { include: [[only]] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
  }, only)
  screens++
  // axe has no rule for a second h1, and a screen reader's heading list wants exactly one: checked here.
  const h1s = await page.locator('h1').count()
  if (h1s !== 1) findings.push({ screen, id: 'one-h1', impact: 'serious', help: `A page has exactly one h1 (this one has ${h1s})`, helpUrl: '', nodes: [] })
  for (const v of result.violations) {
    findings.push({
      screen, id: v.id, impact: v.impact ?? 'minor', help: v.help, helpUrl: v.helpUrl,
      nodes: v.nodes.map((n) => ({ target: n.target.map(String).join(' '), summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').trim() })),
    })
  }
  console.log(`checked ${screen}: ${result.violations.length} rule${result.violations.length === 1 ? '' : 's'} failed`)
}

// The demo API runs on a fixed clock (4 Nov 2026), and the app refuses a sign-in whose expiry is already past on the
// device's own clock. So the browser's clock is set to the API's own idea of "now", as the status page reports it.
let serverNow: Date | null = null
async function apiNow(): Promise<Date> {
  if (serverNow) return serverNow
  const s = (await (await fetch(`${API ?? WEB}/api/status`)).json()) as { checkedAt: string }
  return (serverNow = new Date(s.checkedAt))
}

async function newPage(browser: Browser, device: Device, lang: 'en' | 'ta' = 'en'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(VIEWPORTS[device])
  if (API) await ctx.route(`${WEB}/api/**`, async (route) => route.fulfill({ response: await route.fetch({ url: route.request().url().replace(WEB, API) }) }))
  await ctx.clock.setFixedTime(await apiNow())
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('orders.lang', l) } catch { /* private window */ } }, lang)
  await ctx.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error('Content Security Policy: ' + e.violatedDirective + ' blocked ' + e.blockedURI)) })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|violates the following/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)) })
  return { ctx, page }
}

async function signInMerchandiser(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`)
  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')
}

async function signInSupervisor(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`)
  await page.locator('.seg button').nth(1).click()
  await page.fill('input[type=tel]', SUP.phone)
  await page.fill('input[type=password]', SUP.pin)
  await page.click('form button.btn--primary')
  await page.waitForSelector('.stage')
}

async function merchandiserScreens(browser: Browser, device: Device, buyerToken: string): Promise<void> {
  const tag = (s: string) => `${s} [${device}]`
  const { ctx, page } = await newPage(browser, device)

  await page.goto(`${WEB}/login`)
  await page.waitForSelector('input[type=email]')
  await check(page, tag('Login: merchandiser'))
  await page.locator('.seg button').nth(1).click()
  await page.waitForSelector('input[type=tel]')
  await check(page, tag('Login: supervisor'))
  // No wrong sign-in here: the demo API's lockout counts attempts on a fixed clock, so it would never lift.

  await signInMerchandiser(page)
  await check(page, tag('Board'))
  await page.click('button[aria-label=Menu]')
  // Only the bar is checked with the menu open: the popover covers part of the page below it on purpose, which axe's target-size rule reads as obscured buttons.
  await check(page, tag('Board: menu open'), 'header.appbar')
  await page.keyboard.press('Escape')

  await page.goto(`${WEB}/orders/new`)
  await page.waitForSelector('form.form')
  await check(page, tag('Order setup'))
  await page.click('button:has-text("Create order")')
  await page.waitForSelector('.banner[role=alert]')
  await check(page, tag('Order setup: with errors'))

  await page.goto(`${WEB}/board`)
  await page.waitForSelector('table.board')
  await page.click('a.po-link >> nth=0')
  await page.waitForSelector('.stagecard')
  await check(page, tag('Order detail'))

  await page.goto(`${WEB}/review`)
  await page.waitForSelector('h2:has-text("Buyer links")')
  await check(page, tag('Review'))

  for (const t of ['people', 'days', 'templates', 'alerts', 'housekeeping']) {
    await page.goto(`${WEB}/setup?tab=${t}`)
    await page.waitForSelector('nav[aria-label="Setup sections"]')
    await check(page, tag(`Setup: ${t}`))
  }

  await page.goto(`${WEB}/status`)
  await page.waitForSelector('.checks')
  await check(page, tag('Status'))
  await ctx.close()

  const buyer = await newPage(browser, device)
  await buyer.page.goto(`${WEB}/buyer#${buyerToken}`)
  await buyer.page.waitForSelector('.stagecard')
  await check(buyer.page, tag('Buyer page'))
  await buyer.ctx.close()
  const bad = await newPage(browser, device)
  await bad.page.goto(`${WEB}/buyer`)
  await bad.page.waitForSelector('[role=alert]')
  await check(bad.page, tag('Buyer page: link not valid'))
  await bad.ctx.close()
}

async function supervisorScreens(browser: Browser, device: Device, lang: 'en' | 'ta'): Promise<void> {
  const tag = (s: string) => `${s} [${device}, ${lang}]`
  const { ctx, page } = await newPage(browser, device, lang)
  await signInSupervisor(page)
  await check(page, tag('Today'))
  await page.click('.stage >> nth=0 >> a.btn')
  await page.waitForSelector('input.input--big')
  await check(page, tag('Update'))
  await page.locator('label.reason').nth(2).click()
  await page.fill('textarea', 'Machine stopped for two hours')
  await page.fill('input.input--big', '60')
  await check(page, tag('Update: reason, note and pieces filled in'))
  await page.fill('input.input--big', '99999')
  await page.click('form button.btn--big')
  await page.waitForSelector('.banner')
  await check(page, tag('Update: too many pieces, asking once'))
  await ctx.close()
}

await up()
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })

// One buyer link for the buyer screens: made through the API, cancelled again at the end.
const api = async (p: string, init: RequestInit = {}) => (await fetch(`${API ?? WEB}${p}`, init)).json() as Promise<any>   // eslint-disable-line @typescript-eslint/no-explicit-any
const login = await api('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(MERCH) })
const auth = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }
const options = await api('/api/orders/options', { headers: auth })
const link = await api('/api/buyer-links', { method: 'POST', headers: auth, body: JSON.stringify({ buyerId: options.buyers.find((b: { name: string }) => b.name === 'Buyer B').id, days: 1, label: 'a11y check' }) })

try {
  for (const device of ['phone', 'desktop'] as const) {
    await merchandiserScreens(browser, device, link.token)
    await supervisorScreens(browser, device, 'en')
    await supervisorScreens(browser, device, 'ta')
  }
} finally {
  await api(`/api/buyer-links/${link.id}/revoke`, { method: 'POST', headers: auth, body: '{}' })
  await browser.close()
}

// ---------------------------------------------------------------- report
const hard = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical')
const soft = findings.filter((f) => !hard.includes(f))
const print = (list: Finding[]) => {
  const by = new Map<string, Finding[]>()
  for (const f of list) by.set(f.screen, [...(by.get(f.screen) ?? []), f])
  for (const [screen, fs] of by) {
    console.log(`\n  ${screen}`)
    for (const f of fs) {
      console.log(`    [${f.impact}] ${f.id}: ${f.help} (${f.nodes.length} element${f.nodes.length === 1 ? '' : 's'})`)
      for (const n of f.nodes.slice(0, 3)) console.log(`        ${n.target}\n          ${n.summary.slice(0, 220)}`)
    }
  }
}
console.log(`\nChecked ${screens} screens.`)
if (soft.length) { console.log('\nModerate and minor (do not fail the run):'); print(soft) }
if (hard.length) {
  console.log('\nSERIOUS or CRITICAL (these fail the run):'); print(hard)
  console.error(`\n${hard.length} serious or critical violation${hard.length === 1 ? '' : 's'}.`)
  process.exit(1)
}
console.log('\nNo serious or critical violations.')
if (cspViolations.length) {
  console.log('\nBLOCKED by the Content-Security-Policy (these fail the run):')
  for (const v of [...new Set(cspViolations)]) console.log(`  ${v}`)
  process.exit(1)
}
console.log('No load was blocked by a Content-Security-Policy (a preview server enforces it; the dev server sends none).')
