// Final bug cycle: BE-077, the merchandiser password policy accepted 'password1234' and '1234567890' (10 characters was the only real rule).
// A merchandiser's password guards every order, so the obvious ones are refused with a plain message. No new dependency: a short built-in list.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, weakPassword, type Db } from '../src/index.js'
import { CREDS, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const EMAIL = 'asha@example.test'

describe('BE-077: weakPassword refuses the obvious', () => {
  it('BE-077: all digits, a common word with digits added, and a keyboard or alphabet run are refused with a plain message', () => {
    for (const pw of ['1234567890', '0987654321', '0000000001', 'password1234', 'Password123!', 'PASSWORD2026', 'qwertyuiop', 'qwerty123456', 'abcdefghij', 'letmein2026', 'welcome12345', 'Knitwear2026', 'iloveyou123', 'admin12345!']) {
      const why = weakPassword(pw, EMAIL)
      expect(why, pw).toBe('That password is too easy to guess. Use a few ordinary words that are not common, with numbers if you like')
    }
  })

  it('BE-077: the old rules are kept (length, too long, the email itself, one repeated character)', () => {
    expect(weakPassword('short', EMAIL)).toBe('The password must be at least 10 characters')
    expect(weakPassword('x'.repeat(201), EMAIL)).toBe('That password is too long')
    expect(weakPassword('asha@example.test', 'asha@example.test')).toBe('That password is too easy to guess')
    expect(weakPassword('aaaaaaaaaaaa', EMAIL)).toBe('That password is too easy to guess')
  })

  it('BE-077: a passphrase and the documented demo password are still allowed (so the demo and the tests keep working)', () => {
    for (const pw of ['demo knitwear 2026', 'a long enough passphrase', 'correct horse battery', 'blue-tea-kettle-42', 'Tiruppur monsoon 7 river']) {
      expect(weakPassword(pw, EMAIL), pw).toBeNull()
    }
    expect(weakPassword(CREDS.password, CREDS.email)).toBeNull()
  })
})

describe('BE-077: the API applies it when a merchandiser account is made', () => {
  let pg: PGlite, db: Db, app: FastifyInstance
  const NOW = new Date('2026-11-04T04:30:00Z')
  beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
  beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
  afterAll(async () => { await pg.close() })

  const token = async () => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token as string
  const make = async (password: string, email = 'a2@x.zz') => app.inject({ method: 'POST', url: '/api/accounts/merchandisers', payload: { email, password, label: 'A' }, headers: { authorization: `Bearer ${await token()}` } })

  it('BE-077: the two passwords from the report are now 400, and a passphrase is 201', async () => {
    expect((await make('password1234')).statusCode).toBe(400)
    expect((await make('1234567890')).statusCode).toBe(400)
    const ok = await make('a long enough passphrase', 'a3@x.zz')
    expect(ok.statusCode).toBe(201)
  })
})
