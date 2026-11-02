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
