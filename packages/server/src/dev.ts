// Local demo API: the real app on an in-memory Postgres with illustrative data.
//   npm run dev:api        then, in another terminal:  npm run dev -w @isocode/web
// The clock is fixed to 4 Nov 2026 so the seeded figures line up. NOT for production.
import { CREDS, TODAY } from '../test/helpers.js'
import { startDemoApi } from './demo.js'

const demo = await startDemoApi()
console.log(`demo API on http://127.0.0.1:${demo.port}  (today = ${TODAY})`)
console.log(`  merchandiser: ${CREDS.email} / ${CREDS.password}`)
console.log(`  supervisor:   ${CREDS.phone} / PIN ${CREDS.pin}`)
