// Takes screenshots of every screen and saves them in uiux/, with an index (uiux/README.md).
// Run again whenever the interface changes:
//
//   npm run dev:api                    (terminal 1)
//   npm run dev -w @isocode/web        (terminal 2)
//   npm run snapshots                  (terminal 3)
//
// It uses the demo data, so the pictures never show real people or orders. It never sends an
// update to the server (offline shots are taken and the browser is closed while offline), so
// running it does not change the demo data. Apart from clock times ("Updated 2:14 AM"), the
// pictures are the same every time.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright-core'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'uiux')
const WEB = process.env.WEB ?? 'http://localhost:5173'
const MERCH = { email: 'm@example.test', password: 'correct horse battery' }
const SUP = { phone: '98765 43210', pin: '4321' }

interface Shot { file: string; title: string; note: string; device: 'desktop' | 'phone' }
const shots: Shot[] = []

async function up(): Promise<void> {
  try { if ((await fetch(`${WEB}/api/health`)).ok) return } catch { /* handled below */ }
  console.error(`The app is not running at ${WEB}. Start it first:\n  npm run dev:api\n  npm run dev -w @isocode/web`)
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f))   // only ever pictures we made
await up()

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true })

async function snap(page: Page, n: number, slug: string, device: Shot['device'], title: string, note: string, fullPage = false) {
  const file = `${String(n).padStart(2, '0')}-${slug}.png`
  await page.evaluate(() => window.scrollTo(0, 0))   // a sticky header would otherwise sit offset in a full-page picture
  await page.waitForTimeout(350)   // let transitions and fonts settle
  await page.screenshot({ path: path.join(OUT, file), fullPage })
  shots.push({ file, title, note, device })
  console.log(`saved ${file}`)
}

// ---------------------------------------------------------------- desktop: merchandiser
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.waitForSelector('text=Sign in')
  await snap(page, 1, 'login-desktop', 'desktop', 'Sign in', 'Merchandiser sign-in. A switch at the top changes to the supervisor form (phone number and PIN).')

  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', 'wrong')
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('[role=alert]')
  await snap(page, 2, 'login-wrong-password', 'desktop', 'Sign in: wrong password', 'A plain message. The password is cleared and the cursor goes back to it. The same message is shown whether the account exists or not.')

  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')
  await snap(page, 3, 'board-desktop', 'desktop', 'Order board', 'Every order, worst first. The counts at the top are filters. Under each order is the working behind its colour. Only the red row is tinted; every status also has an icon and a word.')

  await page.click('.chip--red')
  await snap(page, 4, 'board-filtered-red', 'desktop', 'Order board: filtered to late risk', 'The filter is kept in the web address, so a reload or a shared link keeps it.')
  await page.click('.chip--red')

  await page.click('button[aria-label=Menu]')
  await snap(page, 5, 'board-menu-open', 'desktop', 'App menu', 'Language and sign out live in one menu. Esc closes it and returns focus to the button.')
  await page.keyboard.press('Escape')

  await page.addStyleTag({ content: 'html{filter:grayscale(1)}' })
  await snap(page, 6, 'board-greyscale', 'desktop', 'Order board in greyscale', 'The check that status never depends on colour alone: the late-risk row still reads from its triangle and its words.')
  await page.addStyleTag({ content: 'html{filter:none}' })

  await page.click('button[aria-label=Menu]')
  await page.click('[role=menuitem]:first-child')
  await snap(page, 7, 'board-tamil', 'desktop', 'Order board in Tamil', 'The four status words in Tamil (taken from the design notes; not yet checked with supervisors). Anything not yet translated stays in English rather than guessing.')
  await page.click('button[aria-label=Menu]')
  await page.click('[role=menuitem]:first-child')

  await page.goto(`${WEB}/status`)
  await page.waitForSelector('.checks')
  await snap(page, 8, 'status-page', 'desktop', 'System status', 'Public page with no sign-in: plain Up or Down for the API and the database, nothing about how it is built.')
  await ctx.close()
}

// ---------------------------------------------------------------- phone: merchandiser
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')
  await snap(page, 9, 'board-phone', 'phone', 'Order board on a phone', 'Each order becomes a card. The sentence behind the colour stays under the PO number.', true)
  await ctx.close()
}

// ---------------------------------------------------------------- phone: supervisor
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.click('button:has-text("Supervisor")')
  await snap(page, 10, 'login-supervisor-phone', 'phone', 'Supervisor sign-in', 'Phone number and a 4-digit PIN. The supervisor stays signed in on their own phone.')
  await page.fill('input[type=tel]', SUP.phone)
  await page.fill('input[type=password]', SUP.pin)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('.stage')
  await snap(page, 11, 'today-list-phone', 'phone', 'My orders today', "Only this supervisor's own unit. Large buttons, numbers first, soonest due first. The chip at the top says All sent.", true)

  await page.click('button[aria-label=Menu]')
  await page.click('[role=menuitem]:first-child')
  await snap(page, 12, 'today-list-tamil-phone', 'phone', 'My orders today in Tamil', 'Only the title and the sync chip are in Tamil so far; stage names, labels and buttons are still English. Untranslated text is left in English rather than guessed. The Tamil that is here is unreviewed and must be corrected by supervisors, and the rest still has to be written, before the pilot.', true)
  await page.click('button[aria-label=Menu]')
  await page.click('[role=menuitem]:first-child')

  await page.click('.stage >> nth=0 >> a:has-text("Update")')
  await page.waitForSelector('input.input--big')
  await snap(page, 13, 'update-empty-phone', 'phone', 'Daily update', 'One number, one big button. "Today so far" and "Left" show the effect before anything is sent.')

  await page.fill('input.input--big', '99999')
  await page.click('form button.btn--big')
  await page.waitForSelector('.banner')
  await snap(page, 14, 'update-confirm-too-many', 'phone', 'Daily update: a number larger than what is left', 'A likely typing slip, so the button changes to "Send 99999 anyway" and asks once. Nothing was sent.')

  await page.fill('input.input--big', '120')
  await ctx.setOffline(true)
  await page.click('form button.btn--big')
  await page.waitForSelector('.saved')
  await snap(page, 15, 'update-offline-saved', 'phone', 'Daily update with no signal', 'The number is saved on the phone first. The chip says Offline and how many are waiting. It never says sent until the server has confirmed it.')

  await page.click('a:has-text("My orders today")')
  await page.waitForSelector('.stage')
  await snap(page, 16, 'today-offline-waiting-phone', 'phone', 'My orders today with an update waiting', 'Today so far already includes the waiting 120 pieces, so the supervisor sees the effect straight away.', true)
  await ctx.close()   // closed while offline on purpose: the waiting update is never sent, so the demo data is unchanged
}

// ---------------------------------------------------------------- orders (nothing here changes any data)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')

  await page.click('a:has-text("New order")')
  await page.waitForSelector('form.form')
  await snap(page, 17, 'order-form-empty', 'desktop', 'New order', 'Buyer, PO, style, colour, quantity by size (S, M, L and XL are already named; a size left blank is simply not ordered), ex-factory date and a TNA template.', true)

  await page.click('button:has-text("Create order")')
  await page.waitForSelector('.banner[role=alert]')
  await snap(page, 18, 'order-form-errors', 'desktop', 'New order: everything that is missing', 'Pressing Create with gaps lists every problem in plain words at the top and marks each field. Nothing is sent.', true)

  await page.selectOption('select >> nth=0', { label: 'Buyer B (DE)' })
  await page.getByLabel('PO number').fill('B-PO-90001')
  await page.getByLabel('Style').fill('polo')
  await page.getByLabel('Colour').fill('white')
  const q = page.locator('input[placeholder=Pieces]')
  await q.nth(0).fill('500'); await q.nth(1).fill('1200'); await q.nth(2).fill('800')
  await page.getByLabel('Ex-factory date').fill('2026-11-20')
  await page.selectOption('select >> nth=1', { label: 'Knit tee' })
  await page.waitForSelector('table.plan')
  await snap(page, 19, 'order-form-preview', 'desktop', 'New order: the dates it would get', 'As soon as there is a template and a date, the form shows when each stage must finish, worked backwards from ex-factory (Sundays and closures skipped), before anything is created.', true)

  await page.getByLabel('Ex-factory date').fill('2026-11-10')
  await page.waitForSelector('.notice-box')
  await snap(page, 20, 'order-form-late', 'desktop', 'New order: already late', 'If a stage would already be due, the form says so. The order can still be created and will show as late on the board; it is not refused.', true)

  await page.goto(`${WEB}/board`)
  await page.waitForSelector('table.board')
  await page.click('a.po-link:has-text("B-PO-88240")')
  await page.waitForSelector('.stagecard')
  await snap(page, 21, 'order-detail', 'desktop', 'Order detail', 'Each stage with the planned finish date beside the projected one, how far apart they are, the progress, and the working behind the colour. Ex-factory can be changed here; a reason is required and is kept in the history.', true)
  await ctx.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p2 = await phone.newPage()
  await p2.goto(`${WEB}/login`)
  await p2.fill('input[type=email]', MERCH.email)
  await p2.fill('input[type=password]', MERCH.password)
  await p2.click('button:has-text("Sign in") >> nth=-1')
  await p2.waitForSelector('table.board')
  await p2.click('a.po-link >> nth=0')
  await p2.waitForSelector('.stagecard')
  await snap(p2, 22, 'order-detail-phone', 'phone', 'Order detail on a phone', 'The same page on a narrow screen: stacked, no sideways scrolling.', true)
  await p2.goto(`${WEB}/orders/new`)
  await p2.waitForSelector('form.form')
  await snap(p2, 23, 'order-form-phone', 'phone', 'New order on a phone', 'The order form on a narrow screen.', true)
  await phone.close()
}

// ---------------------------------------------------------------- review queue and the buyer's page
// Opening the review queue makes the system raise the warnings the engine wants; that is derived data and
// changes nothing visible. Making a buyer link adds a row, so the script CANCELS it straight after, and the
// picture of the queue is cropped above the links list so it never shows earlier runs' links.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.fill('input[type=email]', MERCH.email)
  await page.fill('input[type=password]', MERCH.password)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('table.board')
  await page.click('a:has-text("Review")')
  await page.waitForSelector('textarea')
  const top = await page.locator('h2:has-text("Buyer links")').boundingBox()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(350)
  const file = '24-review-queue.png'
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: 1280, height: Math.max(300, Math.round((top?.y ?? 900) - 12)) } })
  shots.push({ file, title: 'Review queue', note: 'Nothing reaches a buyer until a merchandiser confirms it. Each warning shows the wording the buyer would read (editable) and, in grey, the figures behind it that only the factory sees. "Do not show" hides it from buyers.', device: 'desktop' })
  console.log(`saved ${file}`)

  // a buyer opens a real link in a browser with no sign-in
  const token = await page.evaluate(async (creds) => {
    const login = await (await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds) })).json()
    const h = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }
    const opts = await (await fetch('/api/orders/options', { headers: h })).json()
    const buyer = opts.buyers.find((b: { name: string }) => b.name === 'Buyer B')
    const made = await (await fetch('/api/buyer-links', { method: 'POST', headers: h, body: JSON.stringify({ buyerId: buyer.id, days: 1, label: 'snapshot' }) })).json()
    return { token: made.token as string, id: made.id as string, auth: login.token as string }
  }, MERCH)
  const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const bp = await bctx.newPage()
  await bp.goto(`${WEB}/buyer#${token.token}`)
  await bp.waitForSelector('.stagecard')
  await snap(bp, 25, 'buyer-view-phone', 'phone', "What a buyer sees", "A read-only page opened from a private link, with no sign-in. Only this buyer's orders and planned dates, and only warnings a merchandiser has confirmed. No colours, rates, shortfalls or other buyers. The link's secret is removed from the address bar as soon as the page loads.", true)
  await bctx.close()
  await page.evaluate(async (t) => { await fetch(`/api/buyer-links/${t.id}/revoke`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.auth}` }, body: '{}' }) }, token)   // tidy up: the snapshot link is cancelled
  await ctx.close()

  const bad = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p3 = await bad.newPage()
  await p3.goto(`${WEB}/buyer`)
  await p3.waitForSelector('[role=alert]')
  await snap(p3, 26, 'buyer-link-not-valid', 'phone', 'A link that does not work', 'A missing, unknown, cancelled or expired link all show this same message, so nothing tells an outsider which case it was.')
  await bad.close()
}

// ---------------------------------------------------------------- a photo ready to send (nothing is sent)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.click('button:has-text("Supervisor")')
  await page.fill('input[type=tel]', SUP.phone)
  await page.fill('input[type=password]', SUP.pin)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('.stage')
  await page.click('.stage >> nth=0 >> a:has-text("Update")')
  await page.waitForSelector('input.input--big')
  // a large, busy picture made in the page stands in for a camera shot
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 3000, 2000); grad.addColorStop(0, '#2a6f97'); grad.addColorStop(1, '#f4a261')
    g.fillStyle = grad; g.fillRect(0, 0, 3000, 2000)
    for (let i = 0; i < 2500; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 40% ${35 + (i % 30)}%)`; g.fillRect((i * 7919) % 3000, (i * 104729) % 2000, 60 + (i % 90), 60 + (i % 60)) }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.setInputFiles('input[type=file]', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(bytes) })
  await page.waitForSelector('.photobox__preview')
  await page.fill('input.input--big', '120')
  await snap(page, 27, 'update-photo-ready-phone', 'phone', 'Daily update with a photo', 'Tap Add a photo to use the camera. The photo is shrunk on the phone (a large camera picture becomes roughly 150 KB) and its size is shown, so it sends quickly even on a weak signal. It is saved with the update and uploaded when there is signal. Nothing here has been sent.')
  await ctx.close()
}

// ---------------------------------------------------------------- a reason and a Tamil note, ready to send (nothing is sent)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/login`)
  await page.click('button:has-text("Supervisor")')
  await page.fill('input[type=tel]', SUP.phone)
  await page.fill('input[type=password]', SUP.pin)
  await page.click('button:has-text("Sign in") >> nth=-1')
  await page.waitForSelector('.stage')
  await page.click('.stage >> nth=0 >> a:has-text("Update")')
  await page.waitForSelector('input.input--big')
  await page.click('button[aria-label=Menu]')
  await page.click('[role=menuitem]:first-child')   // Tamil
  await page.click('.reason >> nth=2')
  await page.fill('textarea', 'இன்று மூன்று இயந்திரங்கள் வேலை செய்யவில்லை')
  await page.fill('input.input--big', '60')
  await snap(page, 28, 'update-reason-note-tamil-phone', 'phone', 'Daily update: a reason and a note, in Tamil', 'Why is it slow? is a short list of big buttons, so the usual cause is one tap. The note is optional free text typed in Tamil or English. The reason words come from a list the factory controls; the Tamil here is unreviewed and must be corrected by supervisors. Nothing has been sent.', true)
  await ctx.close()
}

await browser.close()

// ---------------------------------------------------------------- the index
const groups: [string, Shot['device']][] = [['Desktop', 'desktop'], ['Phone', 'phone']]
const when = new Date().toISOString().slice(0, 10)
let md = `# Interface snapshots

Pictures of every screen as it looks now, taken from the running app on demo data (not real orders). Regenerate them any time the interface changes:

\`\`\`bash
npm run dev:api                  # terminal 1
npm run dev -w @isocode/web      # terminal 2
npm run snapshots                # terminal 3: rewrites this folder
\`\`\`

Last taken: ${when}. ${shots.length} pictures.

`
for (const [heading, device] of groups) {
  md += `## ${heading}\n\n`
  for (const s of shots.filter((x) => x.device === device)) {
    md += `### ${s.title}\n${s.note}\n\n![${s.title}](${s.file})\n\n`
  }
}
fs.writeFileSync(path.join(OUT, 'README.md'), md)
console.log(`\n${shots.length} snapshots and an index written to uiux/`)
