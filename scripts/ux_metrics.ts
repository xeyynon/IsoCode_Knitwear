// Measures the numbers the UI/UX plan (audit/POA-UIUX.md, section 3) is judged by, so every slice can be compared
// with the one before it. It reads the running demo app and never changes any data:
//
//   DEMO_DATA=fixture npm run dev:api                    (terminal 1)
//   npm run dev -w @isocode/web        (terminal 2)
//   npm run ux                         (terminal 3)
//
// What it can and cannot prove: it drives a real browser with touch emulation, but a desktop browser has no on-screen
// keyboard, so "Send is in view" is measured WITHOUT a keyboard. A real phone is still the final check.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright-core'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = process.env.WEB ?? 'http://localhost:5173'
const MERCH = { email: 'm@example.test', password: 'correct horse battery' }
const SUP = { phone: '98765 43210', pin: '4321' }
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const

try { if (!(await fetch(`${WEB}/api/health`)).ok) throw new Error('not ok') } catch {
  console.error(`The app is not running at ${WEB}. Start it first:\n  DEMO_DATA=fixture npm run dev:api\n  npm run dev -w @isocode/web`)
  process.exit(1)
}

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })

// The demo API's clock is fixed (4 Nov 2026): start each browser clock there so a merchandiser can sign in (see snapshots.ts).
const status = (await (await fetch(`${WEB}/api/status`)).json()) as { checkedAt: string }
async function context(options: Parameters<typeof browser.newContext>[0], lang: 'en' | 'ta' = 'en'): Promise<BrowserContext> {
  const ctx = await browser.newContext(options)
  await ctx.clock.install({ time: new Date(status.checkedAt) })
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('orders.lang', l) } catch { /* private window */ } }, lang)
  return ctx
}
async function merchandiser(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`)
  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')
}
async function supervisor(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`)
  await page.click('.seg button >> nth=1')
  await page.fill('input[type=tel]', SUP.phone)
  await page.fill('input[type=password]', SUP.pin)
  await page.click('button[type=submit], form button.btn--primary')
  await page.waitForSelector('.stage')
}

const rows: [string, string][] = []

// 1. The supervisor's Update screen: is Send inside the first screen once the number field is focused?
for (const lang of ['en', 'ta'] as const) {
  const ctx = await context(PHONE, lang)
  const page = await ctx.newPage()
  await supervisor(page)
  await page.locator('a.stage__go').first().click()
  await page.waitForSelector('input.input--big')
  await page.focus('input.input--big')
  await page.fill('input.input--big', '350')
  const m = await page.evaluate(() => {
    const send = document.querySelector('form button.btn--big') as HTMLElement
    const r = send.getBoundingClientRect()
    return { bottom: Math.round(r.bottom), height: Math.round(r.height), viewport: innerHeight, pageHeight: document.documentElement.scrollHeight }
  })
  rows.push([`Update (${lang}): Send bottom edge vs screen height`, `${m.bottom} of ${m.viewport} px${m.bottom <= m.viewport ? ' (in view)' : ' (below the fold)'}; Send is ${m.height} px high; page is ${m.pageHeight} px tall`])
  await ctx.close()
}

// 2. The merchandiser's board on a phone: where does the first order start?
{
  const ctx = await context(PHONE)
  const page = await ctx.newPage()
  await merchandiser(page)
  const m = await page.evaluate(() => {
    const first = document.querySelector('.board tbody tr') as HTMLElement
    const card = first.getBoundingClientRect()
    return { top: Math.round(card.top + scrollY), cardHeight: Math.round(card.height), viewport: innerHeight }
  })
  rows.push(['Phone board: top of the first order card', `${m.top} of ${m.viewport} px (${Math.round((m.top / m.viewport) * 100)}%); the card is ${m.cardHeight} px tall`])
  await ctx.close()
}

// 3. Setup > People: does any word break in the middle? (a word that needs two line boxes)
for (const [name, options] of [['1280', DESKTOP], ['390', PHONE]] as const) {
  const ctx = await context(options)
  const page = await ctx.newPage()
  await merchandiser(page)
  await page.goto(`${WEB}/setup`)
  await page.waitForSelector('table.people')
  const broken = await page.evaluate(() => {
    const found: string[] = []
    for (const td of document.querySelectorAll('table.people td')) {
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        for (const w of text.matchAll(/\S+/g)) {
          const range = document.createRange()
          range.setStart(n, w.index!)
          range.setEnd(n, w.index! + w[0].length)
          if (range.getClientRects().length > 1) found.push(w[0])
        }
      }
    }
    return found
  })
  rows.push([`People table at ${name} px: words broken in the middle`, broken.length ? `${broken.length}: ${[...new Set(broken)].join(', ')}` : 'none'])
  await ctx.close()
}

// 4. How much markup is written by hand instead of through a shared component (prefix counts over the .tsx files).
{
  const files: string[] = []
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p) } }
  walk(path.join(ROOT, 'packages', 'web', 'src'))
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const count = (re: RegExp) => (src.match(re) ?? []).length
  rows.push(['Hand-written markup in .tsx', [
    `className="btn: ${count(/className="btn/g)}`, `<input: ${count(/<input/g)}`, `className="field: ${count(/className="field/g)}`,
    `className="card: ${count(/className="card/g)}`, `role="alert": ${count(/role="alert"/g)}`,
  ].join(', ')])
  const css = fs.readFileSync(path.join(ROOT, 'packages', 'web', 'src', 'styles.css'), 'utf8')
  rows.push(['Media queries in styles.css', `max-width: ${(css.match(/@media \(max-width/g) ?? []).length}, min-width: ${(css.match(/@media \(min-width/g) ?? []).length}`])
}

// 5. Every screen at five widths: sideways overflow, and controls smaller than the tap size (UI/UX plan, slice 0.8).
// Phone and tablet widths use touch emulation, because the coarse-pointer sizes (48 px) only apply there: that is how Send's 44 px was
// found. 1280 is a mouse, where WCAG 2.5.8's 24 px is the floor. A link inside a sentence is exempt (WCAG 2.5.8); everything else that
// can be pressed is counted.
const WIDTHS = [
  { w: 320, h: 640, touch: true }, { w: 360, h: 740, touch: true }, { w: 390, h: 844, touch: true }, { w: 768, h: 1024, touch: true }, { w: 1280, h: 900, touch: false },
]
interface Small { name: string; w: number; h: number }
interface Found { screen: string; width: number; overflow: boolean; controls: number; small: Small[]; min: number }
const found: Found[] = []
const audit = (page: Page, min: number) => page.evaluate((min) => {
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=menuitem]'
  const small: { name: string; w: number; h: number }[] = []
  let controls = 0
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (el.closest('.visually-hidden')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue   // a 1 px hidden radio or file input: its label is the target
    if (el.tagName === 'A' && cs.display === 'inline' && (el.parentElement?.textContent ?? '').trim() !== (el.textContent ?? '').trim()) continue   // a link inside a sentence
    controls++
    if (r.height < min - 0.5 || r.width < min - 0.5) {
      const name = ((el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)) || el.tagName.toLowerCase()
      small.push({ name, w: Math.round(r.width), h: Math.round(r.height) })
    }
  }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, controls, small }
}, min)
async function measure(page: Page, screen: string, width: number, touch: boolean): Promise<void> {
  await page.waitForTimeout(350)
  const min = touch ? 48 : 24
  const r = await audit(page, min)
  found.push({ screen, width, min, ...r })
}
// The buyer's page needs a real link: make one through the API for the audit and cancel it at the end (AUDIT-03 reported its Download button
// as 40 px on a phone; that was a run without touch emulation: with touch it is 48 px, and this keeps it measured that way).
let buyerLink: { id: string; token: string; authz: Record<string, string> } | null = null
try {
  const login = (await (await fetch(`${WEB}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MERCH.email, password: MERCH.password }) })).json()) as { token: string }
  const authz = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' }
  const board = (await (await fetch(`${WEB}/api/board`, { headers: authz })).json()) as { rows: { buyerId: string }[] }
  const made = (await (await fetch(`${WEB}/api/buyer-links`, { method: 'POST', headers: authz, body: JSON.stringify({ buyerId: board.rows[0]!.buyerId, days: 1, label: 'ux audit' }) })).json()) as { id: string; token: string }
  buyerLink = { id: made.id, token: made.token, authz }
} catch { rows.push(['Buyer page', 'not measured (could not make a link through the API)']) }
for (const { w, h, touch } of WIDTHS) {
  const options = touch ? { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } : { viewport: { width: w, height: h } }
  // before anyone signs in
  { const ctx = await context(options); const page = await ctx.newPage()
    await page.goto(`${WEB}/login`); await page.waitForSelector('input[type=email]'); await measure(page, 'Sign in (merchandiser)', w, touch)
    await page.click('.seg button >> nth=1'); await measure(page, 'Sign in (supervisor)', w, touch)
    await page.goto(`${WEB}/status`); await page.waitForSelector('.checks'); await measure(page, 'Status', w, touch)
    if (buyerLink) { await page.goto(`${WEB}/buyer#${buyerLink.token}`); await page.waitForSelector('button:has-text("Download")'); await measure(page, 'Buyer page', w, touch) }
    await ctx.close() }
  // a merchandiser
  { const ctx = await context(options); const page = await ctx.newPage(); await merchandiser(page)
    await measure(page, 'Board', w, touch)
    await page.goto(`${WEB}/orders/new`); await page.waitForSelector('form'); await measure(page, 'New order', w, touch)
    await page.goto(`${WEB}/board`); await page.waitForSelector('table.board'); await page.locator('a.po-link').first().click(); await page.waitForSelector('.stagecard, .summary'); await measure(page, 'Order detail', w, touch)
    await page.goto(`${WEB}/review`); await page.waitForSelector('.rvbar'); await measure(page, 'Review', w, touch)
    await page.goto(`${WEB}/setup`); await page.waitForSelector('table.people'); await measure(page, 'Setup: people', w, touch)
    await ctx.close() }
  // a supervisor
  { const ctx = await context(options); const page = await ctx.newPage(); await supervisor(page)
    await measure(page, 'Today', w, touch)
    await page.locator('a.stage__go').first().click(); await page.waitForSelector('input.input--big'); await measure(page, 'Update', w, touch)
    await ctx.close() }
}

// 6. Content that runs past its own box (AUDIT-03, finding 1): at 195 px wide (a 390 px phone at 200% zoom, or the largest phone font) the
// supervisor's Update hero pushed the order number and the "Left" figure out of the card, and the page did not scroll sideways, so section 5
// could not see it. Here every element whose content is wider than the element itself is reported, unless the element scrolls on purpose
// (overflow auto or scroll) or cuts text with an ellipsis. Today and Update, English and Tamil.
interface Spill { screen: string; lang: string; where: string; by: number }
const spills: Spill[] = []
const spillOf = (page: Page) => page.evaluate(() => {
  const out: { where: string; by: number }[] = []
  for (const el of Array.from(document.querySelectorAll('main, main *, header, header *'))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') continue
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.textOverflow === 'ellipsis') continue
    if (el.closest('.visually-hidden, .sr-only, svg')) continue
    const by = el.scrollWidth - el.clientWidth
    if (el.clientWidth > 2 && by > 1) out.push({ where: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`, by })
  }
  return out
})
for (const lang of ['en', 'ta'] as const) {
  const ctx = await context({ viewport: { width: 195, height: 422 }, hasTouch: true, isMobile: true }, lang)
  const page = await ctx.newPage()
  await supervisor(page)
  await page.waitForTimeout(350)
  for (const s of await spillOf(page)) spills.push({ screen: 'Today', lang, where: s.where, by: s.by })
  await page.locator('a.stage__go, a.stagetile__go, .stage a.btn').first().click()
  await page.waitForSelector('input.input--big')
  await page.waitForTimeout(350)
  for (const s of await spillOf(page)) spills.push({ screen: 'Update', lang, where: s.where, by: s.by })
  await ctx.close()
}

if (buyerLink) await fetch(`${WEB}/api/buyer-links/${buyerLink.id}/revoke`, { method: 'POST', headers: buyerLink.authz })   // cancel the audit's link
await browser.close()
const problems = found.filter((f) => f.overflow || f.small.length)
const lines: string[] = []
for (const f of problems) {
  const bits = [f.overflow ? 'SIDEWAYS OVERFLOW' : '', f.small.length ? `${f.small.length} of ${f.controls} controls under ${f.min} px: ${f.small.slice(0, 5).map((s) => `${s.name} ${s.w}x${s.h}`).join(', ')}${f.small.length > 5 ? ', ...' : ''}` : ''].filter(Boolean)
  lines.push(`${f.screen} @ ${f.width}: ${bits.join('; ')}`)
}
rows.push(['Screens clean at five widths (no overflow, no control under the tap size)', `${found.length - problems.length} of ${found.length}`])
rows.push(['Controls measured', `${found.reduce((n, f) => n + f.controls, 0)} across ${found.length} screen-widths`])
rows.push(['Sideways overflow', `${found.filter((f) => f.overflow).length} screen-widths`])
rows.push(['Controls under the tap size (48 px touch, 24 px mouse)', `${found.reduce((n, f) => n + f.small.length, 0)} in ${found.filter((f) => f.small.length).length} screen-widths`])
rows.push(['Content past its own box at 195 px (Today and Update, English and Tamil)', spills.length === 0 ? 'none' : `${spills.length} element${spills.length === 1 ? '' : 's'}: ${spills.slice(0, 4).map((s) => `${s.screen} ${s.lang} ${s.where} by ${s.by} px`).join('; ')}${spills.length > 4 ? '; ...' : ''}`])
console.log(`\nUI/UX metrics (${new Date().toISOString().slice(0, 10)}, demo data, touch emulation on phone runs)\n`)
for (const [k, v] of rows) console.log(`- ${k}: ${v}`)
if (lines.length) { console.log('\nScreens with a problem:\n'); for (const l of lines) console.log(`- ${l}`) }
if (spills.length) { console.log('\nContent past its own box at 195 px:\n'); for (const s of spills) console.log(`- ${s.screen} (${s.lang}): ${s.where} by ${s.by} px`) }
