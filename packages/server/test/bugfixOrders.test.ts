import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, exportFileName, type Db } from '../src/index.js'
import * as orderService from '../src/orderService.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Fixes BE-013 (control characters in a stage name), BE-016 (long PO), BE-017 (template error dates), BE-022 (quantity message),
// BE-028 (export file name), BE-029 (size names) and the dead-code half of BE-030.
const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const post = async (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: await merch() })
const order = (over: object = {}) => ({
  buyerId: ID.buyerB, po: 'B-PO-90001', style: 'polo', colour: 'white', sizes: { S: 500, M: 1200 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID, ...over,
})
const create = (over: object = {}) => post('/api/orders', order(over))
const tpl = (stages: object[], name = 'New one') => post('/api/templates', { name, stages })
const st = (stage: string, workingDaysBefore: number) => ({ stage, workingDaysBefore, unitId: ID.unit1 })

describe('BE-013: a template stage name must be one that can be sent in an update', () => {
  it.each([['a bell character', 'cut\u0007ting'], ['a start-of-heading character', 'cut\u0001ting'], ['a delete character', 'cut\u007Fting'], ['a zero character', 'cut\u0000ting']])(
    'BE-013: %s in a stage name is refused and nothing is saved', async (_l, name) => {
      const res = await tpl([st(name, 5), st('packing', 0)])
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toBe(`Stage 1's name has a character that is not allowed`)
      expect((await pg.query(`select 1 from tna_template where name = 'New one'`)).rows).toHaveLength(0)
    })
  it('BE-013: ordinary and Tamil stage names are still saved', async () => {
    expect((await tpl([st('தையல்', 5), st('Packing', 0)])).statusCode).toBe(201)
  })
})

describe('BE-017: a rejected template speaks in offsets, not in dates nobody entered', () => {
  it('BE-017: the message names the two stages and their offsets and holds no date', async () => {
    const res = await tpl([st('cutting', 2), st('sewing', 5)])
    expect(res.statusCode).toBe(400)
    const msg: string = res.json().error.message
    expect(msg).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(msg).not.toMatch(/20\d\d/)
    expect(msg).toBe('This template does not work: "sewing" would finish before "cutting" (5 working days before ex-factory, against 2). List the stages in the order they happen, with the biggest number first.')
  })
  it('BE-017: two faults are both named', async () => {
    const res = await tpl([st('a', 1), st('b', 4), st('c', 9)])
    expect(res.json().error.message).toMatch(/"b" would finish before "a".*"c" would finish before "b"/)
  })
  it('BE-017: a repeated stage name is still refused with the engine\'s words', async () => {
    const res = await tpl([st('a', 4), st('A', 3)])
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/appears twice/)
  })
})

describe('BE-016: a PO, style or colour that is too long is refused, not cut', () => {
  it.each([['PO', 'po'], ['Style', 'style'], ['Colour', 'colour']])('BE-016: a %s of 201 characters is a 400 that says so', async (label, field) => {
    const res = await create({ [field]: 'A'.repeat(201) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe(`${label} must be at most 200 characters`)
    expect((await pg.query(`select 1 from orders where po = $1`, ['B-PO-90001'])).rows).toHaveLength(0)
  })
  it('BE-016: two long POs that differ only at the end are no longer taken for duplicates', async () => {
    expect((await create({ po: 'A'.repeat(250) + '1' })).statusCode).toBe(400)
    expect((await create({ po: 'A'.repeat(250) + '2' })).statusCode).toBe(400)
  })
  it('BE-016: exactly 200 characters, and spaces around a value, are fine', async () => {
    const res = await create({ po: `  ${'A'.repeat(200)}  ` })
    expect(res.statusCode).toBe(201)
    expect((await pg.query<{ po: string }>(`select po from orders where id = $1`, [res.json().orderId])).rows[0]!.po).toBe('A'.repeat(200))
  })
})

describe('BE-022: the quantity message tells the truth', () => {
  it('BE-022: a quantity sent as text is told it must be a number, not that 300 differs from 300', async () => {
    const res = await create({ sizes: { M: 300 }, qty: '300' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('Quantity must be a number')
  })
  it('BE-022: a quantity of null means none was sent', async () => {
    const res = await create({ sizes: { M: 300 }, qty: null })
    expect(res.statusCode).toBe(201)
  })
  it('BE-022: a number that differs still says both numbers', async () => {
    const res = await create({ sizes: { M: 300 }, qty: 999 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('Quantity 999 does not match the sizes, which add up to 300')
  })
  it('BE-022: a matching number is accepted', async () => {
    expect((await create({ sizes: { M: 300 }, qty: 300 })).statusCode).toBe(201)
  })
})

describe('BE-029: size names are tidied before they are kept', () => {
  it('BE-029: " S" and "S" are one size, so listing both is refused', async () => {
    const res = await create({ sizes: { ' S': 100, S: 200 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('The size S is listed twice')
    expect((await pg.query(`select 1 from orders where po = 'B-PO-90001'`)).rows).toHaveLength(0)
  })
  it('BE-029: a size with spaces around it is stored without them', async () => {
    const res = await create({ sizes: { ' S ': 100, M: 200 } })
    expect(res.statusCode).toBe(201)
    expect(res.json().qty).toBe(300)
    const sizes = (await pg.query<{ sizes: Record<string, number> }>(`select sizes from orders where id = $1`, [res.json().orderId])).rows[0]!.sizes
    expect(sizes).toEqual({ S: 100, M: 200 })
  })
  it('BE-029: the length limit counts the name without its spaces', async () => {
    expect((await create({ sizes: { [` ${'x'.repeat(20)} `]: 100 } })).statusCode).toBe(201)
    expect((await create({ po: 'P2', sizes: { ['y'.repeat(21)]: 100 } })).statusCode).toBe(400)
  })
})

describe('BE-028: the export file name never ends a part with two hyphens', () => {
  it('BE-028: a name cut at 40 characters on a separator does not leave "--"', () => {
    const name = `${'a'.repeat(39)} ${'b'.repeat(10)}`
    const file = exportFileName(name, '2026-11-08')
    expect(file).toBe(`orders-${'a'.repeat(39)}-2026-11-08.csv`)
    expect(file).not.toMatch(/--/)
  })
  it('BE-028: no name makes a doubled hyphen', () => {
    for (let n = 30; n < 45; n++) expect(exportFileName(`${'a'.repeat(n)} - ${'b'.repeat(9)}`, '2026-11-08')).not.toMatch(/--/)
  })
  it('BE-028: the earlier cases are unchanged', () => {
    expect(exportFileName('Buyer B', '2026-11-04')).toBe('orders-buyer-b-2026-11-04.csv')
    expect(exportFileName('தமிழ்', '2026-11-04')).toBe('orders-buyer-2026-11-04.csv')
  })
})

describe('BE-030: code nobody calls is gone', () => {
  it('BE-030: orderService no longer carries the unused loadTemplateSteps', () => {
    expect(Object.keys(orderService)).not.toContain('loadTemplateSteps')
  })
})
