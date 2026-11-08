// Bug round 2: BE-072, the README said photo upload is for supervisors only; the code also lets a merchandiser upload one on behalf.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const README = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'README.md'), 'utf8')
let pg: PGlite
let db: Db
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg); await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

const rowOf = (route: string) => README.split(/\r?\n/).find((l) => l.startsWith('|') && l.includes(route)) ?? ''

describe('BE-072: the README says who may upload a photo', () => {
  it('BE-072: a merchandiser can upload (the code allows it), and the README row for the upload names both roles', async () => {
    const app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => new Date('2026-11-04T04:30:00Z'), media: memoryMediaStore() })
    const token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
    const jpeg = Buffer.alloc(2000, 0x41); jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[1998] = 0xff; jpeg[1999] = 0xd9
    const res = await app.inject({
      method: 'POST', url: '/api/photos', payload: jpeg,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' },
    })
    expect(res.statusCode).toBe(200)
    const row = rowOf('`POST /api/photos`')
    expect(row).toMatch(/supervisor/i)
    expect(row).toMatch(/merchandiser/i)
    expect(row).not.toMatch(/^\|[^|]*\|\s*supervisor\s*\|/i)    // the access column is not the bare word "supervisor"
  })
})
