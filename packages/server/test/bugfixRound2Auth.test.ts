// Bug round 2: BE-070, the sign-in lock message said "in 15 minutes" however long was left.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, MAX_FAILED_ATTEMPTS, type Db } from '../src/index.js'
import { CREDS, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const START = new Date('2026-11-04T04:30:00Z')
let now = START
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); now = START; app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => now }) })
afterAll(async () => { await pg.close() })

let ip = 0
const signIn = async (body: object) => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: body, remoteAddress: `10.2.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}` })
  return { status: res.statusCode, message: (res.json() as { error?: { message: string } }).error?.message ?? '' }
}
const later = (seconds: number) => { now = new Date(START.getTime() + seconds * 1000) }
const FIRST = 'Too many wrong attempts.'

describe('BE-070: the lock message says how many minutes are really left', () => {
  const UNKNOWN = '9000020011'
  const lockBoth = async () => { for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) { await signIn({ phone: CREDS.phone, pin: '9999' }); await signIn({ phone: UNKNOWN, pin: '9999' }) } }

  it('BE-070: right after the lock it says 15; later it counts down, rounded up, to a minimum of 1; a real and an unknown phone always match', async () => {
    await lockBoth()
    const cases: [number, string][] = [
      [0, 'Try again in 15 minutes.'],
      [30, 'Try again in 15 minutes.'],          // 14 min 30 s left rounds up to 15
      [60, 'Try again in 14 minutes.'],
      [270, 'Try again in 11 minutes.'],         // 10 min 30 s left
      [14 * 60, 'Try again in 1 minute.'],       // exactly one minute left
      [14 * 60 + 59, 'Try again in 1 minute.'],  // one second left: never "0 minutes"
    ]
    for (const [seconds, words] of cases) {
      later(seconds)
      const real = await signIn({ phone: CREDS.phone, pin: CREDS.pin })
      const unknown = await signIn({ phone: UNKNOWN, pin: '9999' })
      expect(real.status, `${seconds} s`).toBe(429)
      expect(real.message.startsWith(FIRST), `${seconds} s`).toBe(true)
      expect(real.message, `${seconds} s`).toContain(words)
      expect(unknown, `${seconds} s`).toEqual(real)
    }
  })

  it('BE-070: an unknown email behaves the same', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) { await signIn({ email: CREDS.email, password: 'nope' }); await signIn({ email: 'nobody@example.test', password: 'nope' }) }
    later(8 * 60)
    const real = await signIn({ email: CREDS.email, password: 'nope' })
    const unknown = await signIn({ email: 'nobody@example.test', password: 'nope' })
    expect(real.message).toContain('Try again in 7 minutes.')
    expect(unknown).toEqual(real)
  })

  it('BE-070: the rest of the message is unchanged', async () => {
    await lockBoth()
    later(120)
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).message).toBe('Too many wrong attempts. Try again in 13 minutes. If you forgot your PIN or password, ask your merchandiser to reset it.')
  })
})
