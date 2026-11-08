// The exit check for the supervisor app, run in a real browser:
//   "20 updates entered in flight mode all arrive once after reconnecting."
// It also checks the harder cases: the app being restarted while offline, and a server that
// processes a batch whose reply is then lost.
//   npm run e2e        (needs Microsoft Edge, or Chrome with E2E_BROWSER=chrome; builds the app and starts everything itself)
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Page } from 'playwright-core'
import { startDemoApi } from '../packages/server/src/demo.js'
import { CREDS, ID } from '../packages/server/test/helpers.js'

const WEB = 'http://localhost:4173'
// E2E_API_PORT lets this run beside a dev API that already holds 8787 (a second session may be using it).
const API_PORT = Number(process.env.E2E_API_PORT ?? 8787)
const results: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail?: string) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

function killTree(p: ChildProcess) {
  try {
    if (!p.pid) return
    if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' })
    else process.kill(-p.pid)   // the whole group: the preview was started detached
  } catch { /* already gone */ }
}

async function waitFor(url: string, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)) }
  throw new Error(`${url} did not come up`)
}

async function eventsFor(demo: Awaited<ReturnType<typeof startDemoApi>>) {
  const r = await demo.pg.query<{ n: number; total: number; distinct_ids: number }>(
    `select count(*)::int as n, coalesce(sum(qty),0)::int as total, count(distinct client_uuid)::int as distinct_ids
       from update_event where order_id = $1 and stage = 'sewing' and date = '2026-11-04'`, [ID.orderRed])
  return r.rows[0]!
}

// Set E2E_SHOTS=<folder> to also save screenshots of the key moments.
const shot = async (page: Page, name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }) }
const chip = (page: Page) => page.locator('.sync').first()
const chipText = async (page: Page) => ((await chip(page).textContent()) ?? '').replace(/\s+/g, ' ').trim()

/** Enter a number and tap Send. Returns only once THIS update is saved on the phone, and any sync it started has finished. */
/** A big, busy picture made in the page (stands in for a camera shot), as bytes. */
async function fakeCameraShot(page: Page, w = 2400, h = 1600): Promise<Buffer> {
  const bytes = await page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w!; c.height = h!
    const g = c.getContext('2d')!
    g.fillStyle = '#2a6f97'; g.fillRect(0, 0, w!, h!)
    for (let i = 0; i < 3000; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 40)}%)`; g.fillRect((i * 7919) % w!, (i * 104729) % h!, 40 + (i % 90), 40 + (i % 60)) }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, [w, h])
  return Buffer.from(bytes)
}

async function sendPieces(page: Page, qty: number) {
  await page.fill('input.input--big', String(qty))
  await page.click('form button.btn--big')
  try {
    await page.waitForFunction((q) => document.querySelector('.saved')?.textContent?.includes('Saved ' + q + ' pieces'), qty, { timeout: 8000 })
    await page.waitForFunction(() => !/Sending/.test(document.querySelector('.sync')?.textContent ?? ''), null, { timeout: 8000 })
  } catch (e) {
    console.log('  sendPieces stuck at', qty, '| chip:', await chipText(page), '| saved:', await page.locator('.saved').textContent().catch(() => null), '| input:', await page.inputValue('input.input--big').catch(() => null), '| button disabled:', await page.locator('button:has-text("Send")').first().isDisabled().catch(() => null))
    throw e
  }
}

const demo = await startDemoApi({ port: API_PORT, origins: [WEB, 'http://127.0.0.1:4173'] })
let preview: ChildProcess | null = null
let exit = 0
try {
  console.log('building the app...')
  execSync('npm run build -w @isocode/web', { stdio: 'inherit', env: { ...process.env, VITE_API_BASE: `http://127.0.0.1:${API_PORT}` } })
  preview = spawn('npm', ['run', 'preview', '-w', '@isocode/web'], { shell: true, stdio: 'ignore', detached: process.platform !== 'win32' })
  await waitFor(`${WEB}/precache.json`)

  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })   // E2E_BROWSER=chrome elsewhere
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  // The checks below read English words; a supervisor with no stored language now gets Tamil, so say English first.
  await ctx.addInitScript(() => { try { window.localStorage.setItem('orders.lang', 'en') } catch { /* private window */ } })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // The preview server sends the app's Content-Security-Policy (scripts/csp.mjs); the browser reports a blocked load as a console error.
  const cspViolations: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|violates the following/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)) })
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error('Content Security Policy: ' + e.violatedDirective + ' blocked ' + e.blockedURI)) })

  // ---- sign in as a supervisor and let the service worker store the app
  await page.goto(`${WEB}/login`)
  await page.click('button:has-text("Supervisor")')
  await page.fill('input[type=tel]', CREDS.phone)
  await page.fill('input[type=password]', CREDS.pin)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('.stage')
  await page.evaluate(() => navigator.serviceWorker.ready)
  const cached = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n })
  check('the service worker stored the app (page + every script and stylesheet)', cached >= 9, `${cached} files`)
  const unit1Stages = await page.locator('.stage').count()
  const listText = (await page.textContent('main')) ?? ''
  check("the list shows only this supervisor's own unit (3 stages, no other unit's orders)", unit1Stages === 3 && !/C-PO/.test(listText), `${unit1Stages} stages`)
  check('nothing waiting at the start: "All sent"', (await chipText(page)).includes('All sent'), await chipText(page))
  await shot(page, 's1-today-online')
  const before = await eventsFor(demo)

  // ---- go offline and reload: the app must still open, with the saved list
  await ctx.setOffline(true)
  await page.reload()
  await page.waitForSelector('.stage')
  check('with no signal the app still opens after a reload', true)
  await shot(page, 's2-today-offline-saved-list')
  check('it says the list is a saved copy', (await page.textContent('.notice'))?.includes('Showing your list saved') ?? false)

  // ---- 20 updates in flight mode
  await page.click('.stage >> nth=0 >> a:has-text("Update")')
  await page.waitForSelector('input.input--big')
  let sum = 0
  for (let i = 1; i <= 20; i++) { await sendPieces(page, i * 3); sum += i * 3 }
  await shot(page, 's3-update-offline-20-waiting')
  check('20 updates entered offline show as "20 waiting"', (await chipText(page)).includes('20') && (await chipText(page)).includes('waiting'), await chipText(page))
  const mid = await eventsFor(demo)
  check('none reached the server while offline', mid.n === before.n, `${mid.n - before.n} arrived`)

  // ---- the app is closed and reopened while still offline
  await page.reload()
  await page.waitForSelector('.syncbar')
  await page.waitForFunction(() => /20/.test(document.querySelector('.sync')?.textContent ?? ''))
  check('after restarting the app offline, all 20 are still waiting', (await chipText(page)).includes('20'), await chipText(page))

  // ---- signal returns
  await ctx.setOffline(false)
  await page.waitForFunction(() => /All sent/.test(document.querySelector('.sync')?.textContent ?? ''), null, { timeout: 30_000 })
  await shot(page, 's4-update-all-sent')
  const after = await eventsFor(demo)
  check('all 20 arrived, each exactly once', after.n - before.n === 20 && after.distinct_ids - before.distinct_ids === 20, `${after.n - before.n} rows`)
  check('and the pieces add up exactly', after.total - before.total === sum, `${after.total - before.total} of ${sum}`)

  // ---- a processed batch whose reply is lost, then retried
  await page.goto(`${WEB}/today`)
  await page.waitForSelector('.stage')
  await page.click('.stage >> nth=0 >> a:has-text("Update")')
  await page.waitForSelector('input.input--big')
  let lost = 0
  await page.route('**/api/events/batch', async (route) => {
    // the server receives and stores it...
    try { await route.fetch(); lost++ } catch (e) { console.log('  (route.fetch failed:', String((e as Error).message).slice(0, 120), ')') }
    // ...but the phone never hears back. Always abort, or the request would hang forever.
    await route.abort('connectionreset')
  })
  const b4 = await eventsFor(demo)
  for (const q of [11, 22, 33]) await sendPieces(page, q)
  await page.waitForFunction(() => /could not send/.test(document.querySelector('.sync')?.textContent ?? ''))
  const lostRows = await eventsFor(demo)
  check('the server stored them although the reply was lost', lostRows.n - b4.n === 3 && lost >= 1, `${lostRows.n - b4.n} rows, ${lost} lost replies`)
  check('the phone still shows them as waiting (it cannot know)', !(await chipText(page)).includes('All sent'), await chipText(page))
  await page.unroute('**/api/events/batch')
  await page.click('button:has-text("Try now")').catch(() => undefined)
  await page.waitForFunction(() => /All sent/.test(document.querySelector('.sync')?.textContent ?? ''), null, { timeout: 30_000 })
  const final = await eventsFor(demo)
  check('retrying after the lost reply did NOT double-count', final.n - b4.n === 3 && final.total - b4.total === 66, `${final.n - b4.n} rows, ${final.total - b4.total} pieces`)

  // ---- photos: three updates with photos taken with no signal; two photo uploads reach the server but their replies are lost
  await page.goto(`${WEB}/today`)
  await page.waitForSelector('.stage')
  await page.click('.stage >> nth=0 >> a:has-text("Update")')
  await page.waitForSelector('input.input--big')
  const photosBefore = (await demo.pg.query<{ n: number }>('select count(*)::int as n from photo')).rows[0]!.n
  await ctx.setOffline(true)
  const raw = await fakeCameraShot(page)
  const TAMIL_NOTE = 'இன்று மூன்று இயந்திரங்கள் வேலை செய்யவில்லை'
  for (const q of [7, 8, 9]) {
    await page.setInputFiles('input[type=file]', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: raw })
    await page.waitForSelector('.photobox__preview')
    if (q === 7) { await page.click('.reason:has-text("Machine problem")'); await page.fill('textarea', TAMIL_NOTE) }   // one update also carries a reason and a Tamil note
    await sendPieces(page, q)
  }
  check('3 updates with photos taken offline show as "3 waiting"', (await chipText(page)).includes('3'), await chipText(page))
  check('no photo reached the server while offline', (await demo.pg.query<{ n: number }>('select count(*)::int as n from photo')).rows[0]!.n === photosBefore)
  let lostPhotoReplies = 0
  await page.route('**/api/photos', async (route) => {
    if (lostPhotoReplies < 2) { try { await route.fetch(); lostPhotoReplies++ } catch { /* the server is fine */ } await route.abort('connectionreset'); return }
    await route.continue()
  })
  await ctx.setOffline(false)
  for (let i = 0; i < 40 && !/All sent/.test(await chipText(page)); i++) {       // a failed sync waits for the next trigger: nudge it
    await page.click('button:has-text("Try now")').catch(() => undefined)
    await new Promise((r) => setTimeout(r, 700))
  }
  check('everything is eventually sent', /All sent/.test(await chipText(page)), await chipText(page))
  const ph = (await demo.pg.query<{ n: number; small: number; big: number; distinct_linked: number }>(
    `select (select count(*) from photo)::int as n,
            (select count(*) from photo where bytes < 1024)::int as small, (select count(*) from photo where bytes > 400000)::int as big,
            (select count(distinct photo_id) from update_event where photo_id is not null)::int as distinct_linked`)).rows[0]!
  check('exactly 3 photos stored despite two lost upload replies (a retry never makes a second)', ph.n - photosBefore === 3, `${ph.n - photosBefore} new, ${lostPhotoReplies} replies lost`)
  check('each update points at its own photo', ph.distinct_linked === ph.n, `${ph.distinct_linked} linked of ${ph.n}`)
  check('photos were shrunk on the phone (all under 400 KB, none empty)', ph.big === 0 && ph.small === 0, `${ph.big} too big, ${ph.small} too small`)
  const firstPhoto = (await demo.pg.query<{ b: number }>('select max(bytes)::int as b from photo')).rows[0]!.b
  check('and smaller than the original', firstPhoto < raw.length, `${Math.round(firstPhoto / 1024)} KB from ${Math.round(raw.length / 1024)} KB`)
  await page.unroute('**/api/photos')
  const nt = (await demo.pg.query<{ n: number; lang: string; cat: string; txt: string; linked: number }>(
    `select count(*)::int as n, max(language) as lang, max(category) as cat, max(text_ta) as txt,
            (select count(*) from update_event e join note x on x.id = e.note_id where e.qty = 7)::int as linked from note`)).rows[0]!
  check('the Tamil note and reason arrived once, with the update they belong to', nt.n === 1 && nt.lang === 'ta' && nt.cat === 'machine' && nt.txt === TAMIL_NOTE && nt.linked === 1, `${nt.n} note, ${nt.lang}, ${nt.cat}, linked ${nt.linked}`)

  check('no script errors in the page', errors.length === 0, errors.join(' | '))
  check('nothing the app needs was blocked by its Content-Security-Policy', cspViolations.length === 0, cspViolations.join(' | '))
  await browser.close()
} catch (e) {
  console.error('e2e crashed:', e)
  exit = 1
} finally {
  if (preview) killTree(preview)
  await demo.close().catch(() => undefined)
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(exit || (failed.length ? 1 : 0))
