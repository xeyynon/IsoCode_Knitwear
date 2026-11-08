// Local demo API: the real app on an in-memory Postgres.
//   npm run dev:api        then, in another terminal:  npm run dev -w @isocode/web
// Shows the brief's sample POs (demoSeed.ts), with the clock fixed to the demo's today so the figures line up. NOT for production.
// DEMO_DATA=fixture npm run dev:api  serves the small test fixture instead, which the a11y, snapshots and ux scripts check against.
import { CREDS, TODAY } from '../test/helpers.js'
import { startDemoApi } from './demo.js'
import { DEMO_BUYER_TOKENS, DEMO_LOGINS, DEMO_TODAY } from './demoSeed.js'

const fixture = process.env.DEMO_DATA === 'fixture'
const demo = await startDemoApi({ data: fixture ? 'fixture' : 'brief' })
console.log(`demo API on http://127.0.0.1:${demo.port}  (today = ${fixture ? TODAY : DEMO_TODAY}, ${fixture ? 'test fixture' : "the brief's sample data"})`)
if (fixture) {
  console.log(`  merchandiser: ${CREDS.email} / ${CREDS.password}`)
  console.log(`  supervisor:   ${CREDS.phone} / PIN ${CREDS.pin}`)
} else {
  console.log(`  merchandiser: ${DEMO_LOGINS.merchandiser.email} / ${DEMO_LOGINS.merchandiser.password}`)
  for (const s of DEMO_LOGINS.supervisors) console.log(`  supervisor:   ${s.phone} / PIN ${s.pin}  (${s.label})`)
  console.log(`  buyer pages:  http://localhost:5173/buyer#${DEMO_BUYER_TOKENS.companyB}  (Company B)`)
  console.log(`                http://localhost:5173/buyer#${DEMO_BUYER_TOKENS.companyC}  (Company C)`)
}
