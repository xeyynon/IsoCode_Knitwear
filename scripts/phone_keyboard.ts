// Drives the app on a REAL Android phone over USB and measures what the on-screen keyboard does to the supervisor's Update screen.
// A desktop browser has no on-screen keyboard, so this is the only way to check the sticky Send bar and `interactive-widget`.
//
// One-off set-up (phone: USB debugging on, screen on and unlocked, Chrome installed; the phone must trust this computer):
//   adb devices -l                                              (the phone must say "device")
//   npm run dev:api                                             (terminal 1)
//   npm run dev -w @isocode/web -- --host 127.0.0.1 --port 5174 --strictPort    (terminal 2: Vite's default listens on IPv6 only, which
//                                                                                the USB tunnel cannot reach: ERR_EMPTY_RESPONSE)
//   adb reverse tcp:5174 tcp:5174                               (the phone's localhost:5174 is now this computer's; localhost keeps
//                                                                it a secure context, so the service worker behaves as in production)
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   adb shell am start -a android.intent.action.VIEW -d http://localhost:5174/login com.android.chrome
//   npm run phone
//
// It only ever uses the tab showing this app (it never reads the phone's other tabs), signs in as the demo supervisor, taps and
// types through Android (so Chrome treats it as a person), and never presses Send with a valid number: nothing reaches the server.
// Pictures of the phone's screen go to audit/phone/ (they show the whole screen, status bar included).
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const ADB = process.env.LOCALAPPDATA + '/Android/Sdk/platform-tools/adb.exe'
const OUT = 'E:/Projects/isocode/New folder/audit/phone'
const adb = (...a) => execFileSync(ADB, a, { maxBuffer: 50e6 })
const shot = (name) => fs.writeFileSync(`${OUT}/${name}.png`, adb('exec-out', 'screencap', '-p'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 30000 })
let page = null
for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().startsWith('http://localhost:5174')) page = p   // only this app's tab is ever used
if (!page) throw new Error('the app tab was not found')
await page.bringToFront()
const cdp = await page.context().newCDPSession(page)

const metrics = () => page.evaluate(() => {
  const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
  const vv = window.visualViewport
  return { innerH: innerHeight, visualH: Math.round(vv.height), visualTop: Math.round(vv.offsetTop), dpr: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches,
    focused: document.activeElement ? document.activeElement.tagName + (document.activeElement.type ? ':' + document.activeElement.type : '') : null,
    send: r('form button.btn--big'), bar: r('.actionbar'), field: r('input.input--big'), scrollY: Math.round(scrollY) }
})
// a real touch at an element's centre (CSS px inside the page), sent as browser input so Chrome treats it as a person's tap
async function tap(selector) {
  const c = await page.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }, selector)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(700)
}
const type = async (text) => { adb('shell', 'input', 'text', text.replace(/ /g, '%s')); await sleep(500) }
const out = {}

out.device = await metrics()
// sign in as the demo supervisor, with real taps and typing
await page.goto('http://localhost:5174/login'); await page.waitForSelector('form input'); await sleep(500)
out.loginOpen = await metrics()
await tap('.seg button:nth-child(2)')
await tap('input[type=tel]'); await sleep(600)
out.loginKeyboard = await metrics(); shot('02-login-keyboard-phone-field')
await type('98765 43210')
await tap('input[type=password]'); await type('4321')
adb('shell', 'input', 'keyevent', '66')   // Enter on the keyboard submits the form
await page.waitForSelector('.stage', { timeout: 15000 }); await sleep(600)
out.today = await metrics(); shot('03-today-phone')
// open Update with a real tap, and see whether the number field has the cursor and the keyboard
await tap('a.stage__go'); await page.waitForSelector('input.input--big'); await sleep(1200)
out.updateArrival = await metrics(); shot('04-update-arrival')
if (out.updateArrival.visualH === out.updateArrival.innerH && out.updateArrival.innerH > 1000) { await tap('input.input--big'); await sleep(800) }
out.updateKeyboard = await metrics(); shot('05-update-keyboard-open')
await type('350')
out.updateTyped = await metrics(); shot('06-update-typed-350')
// the question state: type a number larger than what is left, press Send once (it asks, it does not send)
await page.fill('input.input--big', '')
await tap('input.input--big'); await type('99999')
await tap('form button.btn--big'); await sleep(600)
out.asking = await metrics(); shot('07-update-asking-keyboard')
// scroll the page up with a finger while the keyboard is open: the bar must stay in reach and nothing sits under it
adb('shell', 'input', 'swipe', '540', '900', '540', '1300', '300'); await sleep(700)
out.scrolled = await metrics(); shot('08-update-scrolled-keyboard')
console.log(JSON.stringify(out, null, 1))
await browser.close()   // disconnects only; the phone's browser stays open
