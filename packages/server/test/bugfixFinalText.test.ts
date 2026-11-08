// Final bug cycle: BE-078, a PO number or a size name could hold a tab, a newline or a bidirectional override character
// (U+202E, the right-to-left override: PO + that + 123 is drawn as PO321). On the board, the buyer page and the CSV that spoofs another PO.
// Text a person reads back is now refused when it holds a control or bidi character; a note (free text) has the bidi controls removed.
// The special characters are built from code points here so this file never contains an invisible or reordering character itself.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { normaliseSizes } from '../src/orderService.js'
import { cleanNote } from '../src/noteService.js'
import { cleanLine, hasUnsafeText, stripBidi } from '../src/textRules.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const ch = (n: number) => String.fromCharCode(n)
const TAB = ch(9), LF = ch(10), CR = ch(13), NUL = ch(0), DEL = ch(0x7f), LS = ch(0x2028)
const RLO = ch(0x202e), LRO = ch(0x202d), LRE = ch(0x202a), PDF = ch(0x202c), LRI = ch(0x2066), PDI = ch(0x2069), LRM = ch(0x200e), ALM = ch(0x061c)

describe('BE-078: hasUnsafeText, stripBidi and cleanLine', () => {
  it('BE-078: tab, newline, NUL, DEL, the line separator and every bidi control are unsafe; ordinary text, digits and Tamil are not', () => {
    const unsafe = [`a${TAB}b`, `a${LF}b`, `a${CR}b`, `a${NUL}b`, `a${DEL}b`, `a${LS}b`, `a${RLO}b`, `a${LRO}b`, `a${LRE}b`, `a${PDF}b`, `a${LRI}b`, `a${PDI}b`, `a${LRM}b`, `a${ALM}b`]
    for (const bad of unsafe) expect(hasUnsafeText(bad), JSON.stringify(bad)).toBe(true)
    for (const ok of ['B-PO-88240', "Men's polo", 'XL / 2XL', 'பருத்தி சட்டை', 'Navy blue 12', 'É', '']) expect(hasUnsafeText(ok), ok).toBe(false)
  })
  it('BE-078: stripBidi removes only the bidi controls; cleanLine also turns a run of control characters into one space', () => {
    expect(stripBidi(`PO${RLO}123${LRI}x${LRM}`)).toBe('PO123x')
    expect(stripBidi('plain தமிழ் text')).toBe('plain தமிழ் text')
    expect(cleanLine(`  Tom${RLO}${TAB}${LF}Smith  `)).toBe('Tom Smith')
  })
})

describe('BE-078: sizes', () => {
  it('BE-078: a size name with a tab, a newline or a bidi override is refused; a normal one is kept', () => {
    for (const name of [`M${TAB}L`, `M${LF}L`, `M${RLO}`, `X${LRI}L`, `S${NUL}`]) {
      expect(() => normaliseSizes({ [name]: 10 }), JSON.stringify(name)).toThrow(/not allowed/)
    }
    expect(normaliseSizes({ M: 10, 'XL / 2XL': 5 }).total).toBe(15)
  })
})

describe('BE-078: the API refuses them in an order and in the other names a person reads back', () => {
  let pg: PGlite, db: Db, app: FastifyInstance
  const NOW = new Date('2026-11-04T04:30:00Z')
  beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
  beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
  afterAll(async () => { await pg.close() })

  const hdr = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token as string}` })
  const order = (over: object = {}) => ({ buyerId: ID.buyerB, po: 'FC-1', style: 'tee', colour: 'navy', sizes: { M: 100 }, exFactory: '2026-11-27', templateId: TEMPLATE_ID, ...over })
  const create = async (over: object) => app.inject({ method: 'POST', url: '/api/orders', headers: await hdr(), payload: order(over) })

  it('BE-078: PO, style and colour with a tab, a newline or a bidi override are 400 and nothing is stored', async () => {
    let n = 0
    for (const field of ['po', 'style', 'colour']) {
      for (const bad of [`A${TAB}B`, `A${LF}B`, `A${RLO}B`, `A${LRI}B`]) {
        const res = await create({ [field]: bad, ...(field === 'po' ? {} : { po: `FC-${++n}` }) })
        expect(res.statusCode, `${field} ${JSON.stringify(bad)}`).toBe(400)
        expect(res.json().error.message).toMatch(/not allowed/)
      }
    }
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from orders where po like 'FC-%'`)).rows[0]!.n).toBe(0)
  })

  it('BE-078: a size name with a bidi override is 400 through the API', async () => {
    expect((await create({ sizes: { [`M${RLO}`]: 10 } })).statusCode).toBe(400)
  })

  it('BE-078: ordinary and Tamil text is still accepted', async () => {
    const res = await create({ po: 'FC-OK-1', style: "Men's polo", colour: 'பச்சை / Green' })
    expect(res.statusCode).toBe(201)
  })

  it('BE-078: the reason for a date change, a unit or person name and a buyer-link label refuse or clean the same characters', async () => {
    const h = await hdr()
    const made = await create({ po: 'FC-2' })
    expect(made.statusCode).toBe(201)
    const id = made.json().orderId as string
    const change = (reason: string) => app.inject({ method: 'POST', url: `/api/orders/${id}/ex-factory`, headers: h, payload: { exFactory: '2026-11-28', reason } })
    expect((await change(`late ${RLO}fabric`)).statusCode).toBe(400)
    expect((await change(`late${TAB}fabric`)).statusCode).toBe(400)
    const okChange = await change('late fabric')
    expect(okChange.statusCode, okChange.body).toBe(200)
    const unit = await app.inject({ method: 'POST', url: '/api/units', headers: h, payload: { name: `Unit ${RLO}9`, type: 'own' } })
    expect(unit.statusCode).toBe(400)
    const person = await app.inject({ method: 'POST', url: '/api/accounts/merchandisers', headers: h, payload: { email: 'bidi@x.zz', password: 'blue-tea-kettle-42', label: `Asha${RLO}` } })
    expect(person.statusCode).toBe(400)
    const link = await app.inject({ method: 'POST', url: '/api/buyer-links', headers: h, payload: { buyerId: ID.buyerB, label: `Tom${RLO}${TAB}X` } })
    expect(link.statusCode).toBe(201)
    const stored = (await pg.query<{ label: string | null }>('select label from buyer_link order by created_at desc limit 1')).rows[0]!.label
    expect(stored).toBe('Tom X')
  })

  it('BE-078: a note keeps its words and loses the bidi controls', () => {
    expect(cleanNote(`workers${RLO} on leave${LRI}`)).toBe('workers on leave')
    expect(cleanNote('ஆட்கள் இல்லை')).toBe('ஆட்கள் இல்லை')
  })
})
