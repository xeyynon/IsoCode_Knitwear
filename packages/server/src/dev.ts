// Local demo API: the real app on an in-memory Postgres.
//   npm run dev:api        then, in another terminal:  npm run dev -w @isocode/web
// Shows the brief's sample POs (demoSeed.ts), with the clock fixed to the demo's today so the figures line up. NOT for production.
// DEMO_DATA=fixture npm run dev:api  serves the small test fixture instead, which the a11y, snapshots and ux scripts check against.
import { CREDS, TODAY } from '../test/helpers.js'
import { startDemoApi } from './demo.js'
import { parsePort, StartupConfigError } from './startup.js'
import { classifierFromEnv } from './aiFromEnv.js'
import { DEMO_BUYER_TOKENS, DEMO_LOGINS, DEMO_TODAY } from './demoSeed.js'

const fixture = process.env.DEMO_DATA === 'fixture'
const noteAi = classifierFromEnv(process.env)   // GROQ_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY in this shell turns AI suggestions on; unset, they are off
// PORT (default 8787), read the way the real server reads it. A bad PORT or a port in use is one plain sentence, never a stack.
const demo = await (async () => {
  try { return await startDemoApi({ port: parsePort(process.env.PORT), data: fixture ? 'fixture' : 'brief', noteAi }) } catch (err) {
    if (err instanceof StartupConfigError) { console.error(err.message); process.exit(1) }
    throw err
  }
})()
console.log(`demo API on http://127.0.0.1:${demo.port}  (today = ${fixture ? TODAY : DEMO_TODAY}, ${fixture ? 'test fixture' : "the brief's sample data"})`)
console.log(`  AI suggestions for notes: ${noteAi ? 'on' : 'off (set GROQ_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY to turn them on)'}`)
if (fixture) {
  console.log(`  merchandiser: ${CREDS.email} / ${CREDS.password}`)
  console.log(`  supervisor:   ${CREDS.phone} / PIN ${CREDS.pin}`)
} else {
  console.log(`  merchandiser: ${DEMO_LOGINS.merchandiser.email} / ${DEMO_LOGINS.merchandiser.password}`)
  for (const s of DEMO_LOGINS.supervisors) console.log(`  supervisor:   ${s.phone} / PIN ${s.pin}  (${s.label})`)
  console.log(`  buyer pages:  http://localhost:5173/buyer#${DEMO_BUYER_TOKENS.companyB}  (Company B)`)
  console.log(`                http://localhost:5173/buyer#${DEMO_BUYER_TOKENS.companyC}  (Company C)`)
}
