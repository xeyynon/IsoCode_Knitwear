// BUG-065: malformed input must give a plain 4xx, never a 500 and never a leaked internal.
// This sweeps EVERY route the app registers (app.routeList), so a route added later is covered without anyone
// remembering to add it here: each is hit as each kind of caller with nasty ids, bodies, queries and headers.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
const NOW = new Date('2026-11-04T04:30:00Z')

// Raw JSON text, so values JSON.stringify cannot produce (1e999) can be sent.
const NASTY_JSON = [
  'null', '[]', '{}', '"text"', 'true', '-1', '0.5', '1e999', '123456789012345678901234567890',
  JSON.stringify('x'.repeat(20_000)),
  JSON.stringify('தமிழ் 🧵 ‮ é \ud800 \u0000 end'),
  JSON.stringify('\u0000'),
  '"not-a-uuid"', '"00000000-0000-0000-0000-000000000000"', '"2026-02-30"', '[[[[[[[[[[]]]]]]]]]]', '[null,null,null]',
]
// Every field name any route reads. A flat body sets all of them to the same nasty value.
const KEYS = ['email', 'password', 'phone', 'pin', 'clientUuid', 'orderId', 'stage', 'date', 'qty', 'photoId', 'note', 'events', 'buyerId', 'po', 'style',
  'colour', 'sizes', 'exFactory', 'templateId', 'reason', 'text', 'seenStatus', 'seenText', 'textEn', 'category', 'days', 'label', 'unitId', 'working',
  'disabled', 'name', 'type', 'id', 'stages', 'workingDaysBefore']
const flat = (raw: string) => `{${KEYS.map((k) => `"${k}":${raw}`).join(',')}}`
const BODIES = [
  ...NASTY_JSON, ...NASTY_JSON.map(flat),
  // nested shapes the routes read into
  ...NASTY_JSON.map((v) => `{"sizes":{"S":${v},"M":${v}},"note":{"text":${v},"category":${v}},"stages":[${v}],"events":[${v}, {"clientUuid":${v}}]}`),
  '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}',
  `{"sizes":{${Array.from({ length: 5000 }, (_, i) => `"s${i}":1`).join(',')}}}`,
  '{not json', '', '\u0000',
]
// Path values: every `:id`.
const PARAMS = ['not-a-uuid', '-'.repeat(36), 'f'.repeat(36), 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', '00000000-0000-0000-0000-00000000000g', '00000000-0000-0000-0000-000000000000', 'x'.repeat(5000), '%E0%A4%A', '%', '%00', 'தமிழ்', '🧵', '..%2F..%2Fetc%2Fpasswd', '1e999', '{}', ' ']
// A body that would work, so a single bad field gets past the early checks and reaches the code behind them.
const U = '00000000-0000-0000-0000-0000000000aa'
const VALID = {
  email: CREDS.email, password: CREDS.password, phone: CREDS.phone, pin: CREDS.pin, clientUuid: U, orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 5,
  note: { text: 'slow', category: 'other' }, events: [{ clientUuid: U, orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 1 }], buyerId: ID.buyerB,
  po: 'P1', style: 's', colour: 'c', sizes: { S: 10 }, exFactory: '2026-11-30', templateId: TEMPLATE_ID, reason: 'r', text: 't', seenStatus: 'red', seenText: 't',
  textEn: 'e', category: 'other', days: 7, label: 'l', unitId: ID.unit1, working: false, disabled: false, name: 'n', type: 'own', id: ID.orderRed,
  stages: [{ stage: 'cut', workingDaysBefore: 3, unitId: ID.unit1 }], workingDaysBefore: 3,
}
const ONE_BAD = ['null', '"text"', '1e999', '123456789012345678901234567890', '"not-a-uuid"', JSON.stringify('x'.repeat(2000)), JSON.stringify('a' + String.fromCharCode(0) + 'b')]
const PATHS: (string | number)[][] = [...Object.keys(VALID).map((k) => [k]),
  ['note', 'text'], ['note', 'category'], ['sizes', 'S'], ['events', 0, 'qty'], ['events', 0, 'stage'], ['events', 0, 'clientUuid'], ['events', 0, 'orderId'],
  ['stages', 0, 'stage'], ['stages', 0, 'unitId'], ['stages', 0, 'workingDaysBefore']]
const oneBad = (path: (string | number)[], raw: string): string => {
  const copy = JSON.parse(JSON.stringify(VALID)) as Record<string, any>
  let at: any = copy
  for (const p of path.slice(0, -1)) at = at[p]
  at[path[path.length - 1]!] = '__RAW__'
  return JSON.stringify(copy).replace('"__RAW__"', raw)
}
const ONE_BAD_BODIES = PATHS.flatMap((p) => ONE_BAD.map((v) => oneBad(p, v)))
const QUERIES = ['', '?unitId=not-a-uuid', '?unitId=%00', '?unitId[]=a&unitId[]=b', `?unitId=${'x'.repeat(5000)}`, '?days=1e999', '?%E0%A4%A=1']
const LEAKS = /syntax|postgres|pglite|relation "|column "|violates|\.ts:|\.js:|node_modules|stack|ECONN|at async|invalid input/i

let pg: PGlite
let db: Db
let app: FastifyInstance
const ROUTES = buildApp({ db: null as never, tokenSecret: SECRET }).routeList

beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media: memoryMediaStore() })
})
afterAll(async () => { await pg.close() })

const login = async (b: object) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token as string

describe('the route list', () => {
  it('lists the routes the sweep covers (a quick check that it is not empty)', () => {
    expect(ROUTES.length).toBeGreaterThan(40)
    expect(ROUTES.some((r) => r.url === '/api/events')).toBe(true)
  })
})

describe('no input makes any route answer 5xx or leak an internal', () => {
  it.each(ROUTES.map((r) => [`${r.method} ${r.url}`, r] as const))('%s', async (_name, route) => {
    const merch = { authorization: `Bearer ${await login({ email: CREDS.email, password: CREDS.password })}` }
    const sup = { authorization: `Bearer ${await login({ phone: CREDS.phone, pin: CREDS.pin })}` }
    const linkToken = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: merch, payload: { buyerId: ID.buyerB } })).json().token as string
    const buyer = { authorization: `Bearer ${linkToken}` }
    const callers: Record<string, Record<string, string>> = route.url.startsWith('/api/buyer/') ? { buyer, merch } : { merch, sup, anonymous: {} }

    const bad: string[] = []
    const check = (who: string, what: string, res: { statusCode: number; body: string; headers: Record<string, unknown> }) => {
      const message = (() => { try { return String(JSON.parse(res.body)?.error?.message ?? '') } catch { return '' } })()
      if (res.statusCode >= 500 && !(res.statusCode === 503 && /not set up/.test(message))) bad.push(`${who} ${what} -> ${res.statusCode} ${res.body.slice(0, 120)}`)
      else if (res.statusCode >= 400 && (LEAKS.test(res.body) || (res.headers['content-type'] && !/json/.test(String(res.headers['content-type']))))) bad.push(`${who} ${what} -> leaks: ${res.body.slice(0, 160)}`)
    }
    const urls: string[] = []
    if (route.url.includes(':')) {
      for (const p of PARAMS) urls.push(route.url.replace(/:[A-Za-z]+/g, p.includes('%') ? p : encodeURIComponent(p)))
    } else for (const q of QUERIES) urls.push(route.url + q)

    for (const [who, headers] of Object.entries(callers)) {
      if (route.method === 'GET') {
        for (const url of urls) {
          try { check(who, url.slice(0, 80), await app.inject({ method: 'GET', url, headers })) } catch (e) { bad.push(`${who} ${url.slice(0, 80)} -> threw ${(e as Error).message}`) }
        }
        continue
      }
      for (const url of urls.slice(0, route.url.includes(':') ? urls.length : 1)) {
        for (const body of route.url.includes(':') ? BODIES.filter((_, i) => i % 5 === 0) : BODIES) {
          try {
            check(who, `${url.slice(0, 60)} body ${body.slice(0, 60)}`, await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/json' }, payload: body }))
          } catch (e) { bad.push(`${who} ${url.slice(0, 60)} body ${body.slice(0, 40)} -> threw ${(e as Error).message}`) }
        }
      }
    }
    // A body that would work except for one field (once per bad value): reaches the code behind the early checks.
    if (route.method === 'POST' && !route.url.startsWith('/api/auth')) {
      const who = route.url.startsWith('/api/events') ? 'sup' : 'merch'
      const url = route.url.replace(/:[A-Za-z]+/g, ID.orderRed)
      if (callers[who]) for (const body of ONE_BAD_BODIES) {
        try { check(who, `${url} one bad field ${body.slice(0, 0)}${body.length > 300 ? body.slice(0, 80) + '...' : body}`, await app.inject({ method: 'POST', url, headers: { ...callers[who], 'content-type': 'application/json' }, payload: body })) } catch (e) { bad.push(`${url} one bad field threw ${(e as Error).message}`) }
      }
    }
    // The photo route reads its details from headers, not JSON.
    if (route.url === '/api/photos') {
      const jpeg = Buffer.alloc(2000, 0x41); jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[1998] = 0xff; jpeg[1999] = 0xd9
      const values = ['', 'not-a-uuid', '%E0%A4%A', '%', '%00', 'x'.repeat(8000), encodeURIComponent('தமிழ் 🧵'), '2026-02-30', '1e999', '..%2F..']
      for (const [who, headers] of Object.entries(callers)) {
        for (const v of values) {
          for (const name of ['x-stage', 'x-order-id', 'x-client-uuid', 'x-date']) {
            const h = { ...headers, 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04', [name]: v }
            try { check(who, `${name}=${v.slice(0, 30)}`, await app.inject({ method: 'POST', url: '/api/photos', headers: h, payload: jpeg })) } catch (e) { bad.push(`${who} ${name}=${v.slice(0, 20)} threw ${(e as Error).message}`) }
          }
        }
        check(who, 'not a jpeg', await app.inject({ method: 'POST', url: '/api/photos', headers: { ...headers, 'content-type': 'image/jpeg' }, payload: Buffer.alloc(10) }))
        check(who, 'empty body', await app.inject({ method: 'POST', url: '/api/photos', headers: { ...headers, 'content-type': 'image/jpeg' } }))
      }
    }
    expect(bad.slice(0, 15)).toEqual([])
  }, 240_000)
})

// The cases found by hand, with the exact plain message each must give.
describe('malformed input: the known cases', () => {
  const merchHeaders = async () => ({ authorization: `Bearer ${await login({ email: CREDS.email, password: CREDS.password })}` })
  const supHeaders = async () => ({ authorization: `Bearer ${await login({ phone: CREDS.phone, pin: CREDS.pin })}` })
  const jpeg = () => { const b = Buffer.alloc(2000, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[1998] = 0xff; b[1999] = 0xd9; return b }
  const order = (over: object = {}) => ({ buyerId: ID.buyerB, po: 'FZ-1', style: 'polo', colour: 'white', sizes: { S: 500 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID, ...over })
  const post = async (url: string, payload: unknown, headers?: Record<string, string>) =>
    app.inject({ method: 'POST', url, headers: { ...(headers ?? await merchHeaders()), 'content-type': 'application/json' }, payload: JSON.stringify(payload) })
  const plain = (res: { statusCode: number; json: () => any }, status: number, message: RegExp) => {
    expect(res.statusCode).toBe(status)
    expect(Object.keys(res.json())).toEqual(['error'])
    expect(res.json().error.message).toMatch(message)
    expect(JSON.stringify(res.json())).not.toMatch(LEAKS)
  }

  it.each(['%E0%A4%A', '%', '%00'])('a photo with x-stage "%s" is a 400 that says which header is wrong', async (stage) => {
    const res = await app.inject({
      method: 'POST', url: '/api/photos',
      headers: { ...(await supHeaders()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': stage, 'x-date': '2026-11-04' },
      payload: jpeg(),
    })
    plain(res, 400, /x-stage/)
  })

  it.each(['-'.repeat(36), 'f'.repeat(36), 'not-a-uuid'])('an order id of "%s" is a 400, not a 500', async (id) => {
    plain(await app.inject({ url: `/api/orders/${id}`, headers: await merchHeaders() }), 400, /order/i)
  })
  it('a well-formed id that does not exist is still a 404', async () => {
    plain(await app.inject({ url: '/api/orders/00000000-0000-0000-0000-000000000099', headers: await merchHeaders() }), 404, /./)
  })

  describe('oversized sizes on an order', () => {
    it('allows up to 30 sizes, 100000 pieces each, 1000000 in all', async () => {
      const sizes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`S${i}`, 100_000]))
      const res = await post('/api/orders', order({ sizes }))
      expect(res.statusCode).toBe(201)
      expect(res.json().qty).toBe(1_000_000)
      const thirty = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`W${i}`, 1]))
      expect((await post('/api/orders', order({ po: 'FZ-2', sizes: thirty }))).statusCode).toBe(201)
    })
    it.each([
      ['31 sizes', Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`W${i}`, 1])), /at most 30 sizes/],
      ['5000 sizes', Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`W${i}`, 1])), /at most 30 sizes/],
      ['100001 in one size', { S: 100_001 }, /Size S: .*100000/],
      ['1e308 in one size', { S: 1e308 }, /Size S: .*100000/],
      ['a size name of 21 characters', { ['x'.repeat(21)]: 5 }, /at most 20 characters/],
      ['a total over 1000000', Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`S${i}`, 100_000])), /at most 1000000/],
    ])('refuses %s with a plain message', async (_n, sizes, message) => {
      plain(await post('/api/orders', order({ sizes })), 400, message)
    })
    it('a null body, a list and a string are 400s', async () => {
      for (const body of [null, [], 'text', 5]) plain(await post('/api/orders', body), 400, /./)
    })
    it('the preview refuses oversized sizes too, when it is given them', async () => {
      const sizes = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`W${i}`, 1]))
      plain(await post('/api/orders/preview', { templateId: TEMPLATE_ID, exFactory: '2026-11-20', sizes }), 400, /at most 30 sizes/)
      expect((await post('/api/orders/preview', { templateId: TEMPLATE_ID, exFactory: '2026-11-20' })).statusCode).toBe(200)
    })
  })

  describe('a percent-encoded buyer path', () => {
    it('a staff sign-in does not open the buyer view by spelling its path with an escape, and nothing is a 500', async () => {
      const staff = await merchHeaders()
      for (const url of ['/api/%62uyer/orders', '/api/buyer%2Forders', '/api/buyer/%zz', '/api/%62uyer/export.csv', '/api/buyer/%E0%A4%A']) {
        const res = await app.inject({ url, headers: staff })
        expect([400, 401, 404], url).toContain(res.statusCode)
      }
      plain(await app.inject({ url: '/api/%62uyer/orders', headers: staff }), 401, /link is not valid/)
    })
    it('a buyer link still works on the escaped spelling of the same route, and sees only what the plain spelling shows', async () => {
      const link = (await post('/api/buyer-links', { buyerId: ID.buyerB })).json().token as string
      const plainRes = await app.inject({ url: '/api/buyer/orders', headers: { authorization: `Bearer ${link}` } })
      const escaped = await app.inject({ url: '/api/%62uyer/orders', headers: { authorization: `Bearer ${link}` } })
      expect(plainRes.statusCode).toBe(200)
      expect(escaped.statusCode).toBe(200)
      expect(escaped.json()).toEqual(plainRes.json())
    })
    it('a buyer link does not open a staff route spelled with an escape either', async () => {
      const link = (await post('/api/buyer-links', { buyerId: ID.buyerB })).json().token as string
      for (const url of ['/api/%62oard', '/api/boar%64', '/api/buyers/' + ID.buyerB + '/export.csv']) {
        expect((await app.inject({ url, headers: { authorization: `Bearer ${link}` } })).statusCode, url).toBe(401)
      }
    })
  })

  it('text a database cannot hold (a zero character) is a rejected item or a 400, never a 500', async () => {
    const sup = await supHeaders()
    const good = { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 5 }
    const nul = { ...good, clientUuid: crypto.randomUUID(), stage: 'sew' + String.fromCharCode(0) + 'ing' }
    const batch = await post('/api/events/batch', { events: [nul, good] }, sup)
    expect(batch.statusCode).toBe(200)
    expect(batch.json().results.map((r: any) => r.result)).toEqual(['rejected', 'accepted'])
    expect(batch.json().results[0].message).toMatch(/stage/)
    plain(await post('/api/events', nul, sup), 400, /stage/)
    plain(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a' + String.fromCharCode(0), password: 'x' } }), 401, /Incorrect|not valid/)
  })
})
