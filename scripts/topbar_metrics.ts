// Measures the top bar in a real browser (the ORCA top bar guide, section 11, adapted). A screenshot can look right while something is a few
// pixels off, so the bar is measured, and the run FAILS when a number is wrong. It reads the running demo app and never changes any data
// (the only clicks are on tabs and the menu). Part of `npm run ux`:
//
//   DEMO_DATA=fixture npm run dev:api ;  npm run dev -w @isocode/web ;  npm run ux      (WEB=http://localhost:PORT for another server)
//
// What it checks, and where each number comes from:
//   at 1180, 1280, 1366, 1440 and 1920 px (a merchandiser on the board): the centre tab is centred on the screen (0 px off), the brand, the
//   views and the menu button share one centreline, the side capsules are flush with the screen edges, the bar is 56 px, one h1;
//   a supervisor's centre tab (the page title) is centred too, at 1280 and 390 px;
//   at 390, 320 and 195 px: no sideways overflow, the bar's height, the tap size of the menu button and the views;
//   the menu in the browser: focus on the first row on open, ArrowDown wraps, Esc gives the focus back;
//   the entrance plays once per visit: after a click on another tab no animation runs in the bar.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright-core'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const MERCH = { email: 'm@example.test', password: 'correct horse battery' }
const SUP = { phone: '98765 43210', pin: '4321' }
void path; void fileURLToPath

try { if (!(await fetch(`${WEB}/api/health`)).ok) throw new Error('not ok') } catch {
  console.error(`The app is not running at ${WEB}. Start it first:\n  DEMO_DATA=fixture npm run dev:api\n  npm run dev -w @isocode/web`)
  process.exit(1)
}
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })
const status = (await (await fetch(`${WEB}/api/status`)).json()) as { checkedAt: string }
async function context(options: Parameters<typeof browser.newContext>[0], lang: 'en' | 'ta' = 'en'): Promise<BrowserContext> {
  const ctx = await browser.newContext(options)
  await ctx.clock.install({ time: new Date(status.checkedAt) })
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('orders.lang', l) } catch { /* private window */ } }, lang)
  return ctx
}
async function merchandiser(page: Page) {
  await page.goto(`${WEB}/login`)
  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')
}
async function supervisor(page: Page) {
  await page.goto(`${WEB}/login`)
  await page.click('.seg button >> nth=1')
  await page.fill('input[type=tel]', SUP.phone)
  await page.fill('input[type=password]', SUP.pin)
  await page.click('button[type=submit], form button.btn--primary')
  await page.waitForSelector('.stage, .stagetile')
}

const rows: [string, string, boolean][] = []
const check = (name: string, value: string, ok: boolean) => rows.push([name, value, ok])
// (no named helper functions inside the page: tsx adds a __name helper to them that the browser does not have)
const bar = (page: Page) => page.evaluate(() => {
  const header = document.querySelector('header.appbar') as HTMLElement
  const [centre, left, right, tab, menu] = ['.appbar__center', '.appbar__left', '.appbar__right', '.navtab', '.appbar__right button'].map((s) => document.querySelector(s)?.getBoundingClientRect() ?? null)
  return {
    width: innerWidth,
    scrollW: document.documentElement.scrollWidth,
    height: header?.offsetHeight ?? 0,
    h1s: document.querySelectorAll('h1').length,
    centreOff: centre ? Math.round(((centre.left + centre.right) / 2 - innerWidth / 2) * 10) / 10 : null,
    lines: [left, tab, menu].map((b) => (b ? Math.round(((b.top + b.bottom) / 2) * 10) / 10 : null)),
    leftFlush: left ? Math.round(left.left) : null,
    rightFlush: right ? Math.round(innerWidth - right.right) : null,
    menuBtn: menu ? `${Math.round(menu.width)}x${Math.round(menu.height)}` : null,
    tabH: tab ? Math.round(tab.height) : null,
  }
})

// 1. A merchandiser on a desk: the shapes at five widths
for (const w of [1180, 1280, 1366, 1440, 1920]) {
  const ctx = await context({ viewport: { width: w, height: 900 } })
  const page = await ctx.newPage()
  await merchandiser(page)
  await page.waitForTimeout(700) // the entrance has finished
  const m = await bar(page)
  check(`${w} px, merchandiser: centre tab off the screen centre by`, `${m.centreOff} px`, Math.abs(m.centreOff ?? 99) <= 0.5)
  const lines = m.lines as number[]
  check(`${w} px: brand, views and menu on one centreline`, lines.join(' / '), lines.every((l) => l !== null) && Math.max(...lines) - Math.min(...lines) <= 1)
  check(`${w} px: side capsules flush with the edges (left, right)`, `${m.leftFlush} / ${m.rightFlush} px`, m.leftFlush === 0 && m.rightFlush === 0)
  check(`${w} px: bar height, h1 count`, `${m.height} px, ${m.h1s} h1`, m.height === 56 && m.h1s === 1)
  await ctx.close()
}

// 2. A supervisor's centre tab (the page title) is centred too
for (const w of [1280, 390]) {
  const ctx = await context(w > 500 ? { viewport: { width: w, height: 900 } } : { viewport: { width: w, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await supervisor(page)
  await page.waitForTimeout(700)
  const m = await bar(page)
  check(`${w} px, supervisor: title tab off the screen centre by`, `${m.centreOff} px`, Math.abs(m.centreOff ?? 99) <= 0.5)
  check(`${w} px, supervisor: bar height, h1 count`, `${m.height} px, ${m.h1s} h1`, m.height === 56 && m.h1s === 1)
  await ctx.close()
}

// 3. Phone widths: nothing sideways, the bar's height, tap sizes (touch emulation)
for (const w of [390, 320, 195]) {
  const options = { viewport: { width: w, height: 844 }, hasTouch: true, isMobile: true } as const
  {
    const ctx = await context(options); const page = await ctx.newPage(); await merchandiser(page); await page.waitForTimeout(700)
    const m = await bar(page)
    check(`${w} px, merchandiser: sideways overflow, bar height`, `${m.scrollW > m.width ? 'YES' : 'none'}, ${m.height} px`, m.scrollW <= m.width)
    check(`${w} px, merchandiser: tap size of a view and of the menu button`, `${m.tabH} px / ${m.menuBtn}`, (m.tabH ?? 0) >= 44 && Number((m.menuBtn ?? '0x0').split('x')[1]) >= 44)
    await ctx.close()
  }
  for (const lang of ['en', 'ta'] as const) {
    const ctx = await context(options, lang); const page = await ctx.newPage(); await supervisor(page); await page.waitForTimeout(700)
    const m = await bar(page)
    check(`${w} px, supervisor (${lang}): sideways overflow, bar height`, `${m.scrollW > m.width ? 'YES' : 'none'}, ${m.height} px`, m.scrollW <= m.width)
    check(`${w} px, supervisor (${lang}): tap size of the menu button`, `${m.menuBtn}`, Number((m.menuBtn ?? '0x0').split('x')[1]) >= 44)
    await ctx.close()
  }
}

// 4. The menu, with the keyboard
{
  const ctx = await context({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await merchandiser(page); await page.waitForTimeout(500)
  const button = page.locator('button[aria-haspopup=menu]')
  await button.click()
  const focusedOpen = await page.evaluate(() => document.activeElement?.getAttribute('role'))
  const count = await page.locator('[role=menuitem]').count()
  check('menu: opens with focus on its first row', String(focusedOpen), focusedOpen === 'menuitem')
  for (let i = 0; i < count; i++) await page.keyboard.press('ArrowDown')
  const wrapped = await page.evaluate(() => { const items = [...document.querySelectorAll('[role=menuitem]')]; return items.indexOf(document.activeElement as Element) })
  check(`menu: ArrowDown ${count} times wraps back to the first row`, `row ${wrapped + 1}`, wrapped === 0)
  await page.keyboard.press('Escape')
  const back = await page.evaluate(() => ({ open: !!document.querySelector('[role=menu]'), onButton: document.activeElement?.getAttribute('aria-haspopup') === 'menu' }))
  check('menu: Esc closes it and gives the focus back to the button', `closed ${!back.open}, focus on button ${back.onButton}`, !back.open && back.onButton)
  await ctx.close()
}

// 5. The entrance plays once per visit
{
  const ctx = await context({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await merchandiser(page)
  const first = await page.evaluate(() => (document.querySelector('header.appbar') as HTMLElement).classList.contains('appbar--enter'))
  check('entrance: the first bar of the visit slides in', String(first), first)
  await page.waitForTimeout(700)
  await page.click('.navtab >> nth=1') // Review: a new page, a new bar
  await page.waitForSelector('.rvbar, h2')
  const m = await page.evaluate(() => {
    const header = document.querySelector('header.appbar') as HTMLElement
    return { entering: header.classList.contains('appbar--enter'), running: header.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && /appbar/.test((a as CSSAnimation).animationName ?? '')).length }
  })
  check('entrance: after going to another page the bar has no entrance running', `entering ${m.entering}, running ${m.running}`, !m.entering && m.running === 0)
  await ctx.close()
}

await browser.close()
const failed = rows.filter((r) => !r[2])
console.log(`\nTop bar metrics (${new Date().toISOString().slice(0, 10)}, demo data)\n`)
for (const [k, v, ok] of rows) console.log(`${ok ? 'ok  ' : 'FAIL'} ${k}: ${v}`)
console.log(`\n${rows.length - failed.length} of ${rows.length} checks passed`)
if (failed.length) process.exit(1)
