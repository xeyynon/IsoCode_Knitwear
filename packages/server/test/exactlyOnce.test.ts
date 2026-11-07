// BUG-066: a repeated send that overlaps the first must not store a second note (or a second anything).
//
// What these tests prove, and what they cannot:
//  * "the logic" tests run submitEvent against a small in-memory stand-in for two database connections (read-committed
//    visibility, a per-key advisory lock, a unique key that waits for an uncommitted twin). They prove the ORDER of the
//    work is right: the lock is taken on the client id before the duplicate check and before any note is written, so the
//    second request waits and then reports a duplicate. They cannot prove Postgres behaves like the stand-in.
//  * PGlite is one connection and runs transactions one after another, so the race cannot even happen there. The
//    real-Postgres run (CI, packages/server/test/realPostgres.test.ts) is what proves the lock really serialises two
//    connections: see the note at the end of this file.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { submitEvent, type Ctx, type Db, type Tx } from '../src/index.js'
import { ID, migratedDb, migratedRealDb, pgliteDb, resetAndSeed, usingRealPostgres, type RealPg } from './helpers.js'

const TODAY = '2026-11-04'
const input = (clientUuid: string, over: object = {}) => ({
  clientUuid, orderId: ID.orderRed, stage: 'sewing', date: TODAY, qty: 5, note: { text: 'machine down', category: 'other' }, ...over,
})
const SUP: Ctx = { role: 'supervisor', unitId: ID.unit1 }
const tick = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

// ---------------------------------------------------------------- a stand-in for two connections to one Postgres

function standIn() {
  const committed = new Map<string, { noteId: string | null }>()
  const notes: string[] = []                              // committed notes
  const uncommitted = new Map<string, Promise<void>>()    // client id -> settles when the writing transaction ends
  const locks = new Map<string, Promise<void>>()          // advisory lock key -> end of its queue
  const state = { noteInsertAttempts: 0, log: [] as string[], gate: null as null | { reached: () => void; open: Promise<void> }, gateUsed: false }
  let nextTx = 0

  const begin = () => {
    const name = `tx${++nextTx}`
    const pendingNotes: string[] = []
    const pendingEvents: string[] = []
    const releases: (() => void)[] = []
    let ended!: () => void
    const done = new Promise<void>((r) => { ended = r })
    const log = (what: string) => state.log.push(`${name}: ${what}`)
    const savepoints = new Map<string, number>()
    const end = () => { for (const r of releases) r(); for (const id of pendingEvents) uncommitted.delete(id); ended() }

    const tx: Tx = {
      async query(sql: string, params: unknown[] = []) {
        const s = sql.replace(/\s+/g, ' ').trim()
        if (/pg_advisory_xact_lock/.test(s)) {
          const key = params.map((p) => String(p)).join('|')
          log(`lock ${key}`)
          const prev = locks.get(key) ?? Promise.resolve()
          let release!: () => void
          const mine = new Promise<void>((r) => { release = r })
          locks.set(key, prev.then(() => mine))
          await prev
          releases.push(release)
          log(`got lock ${key}`)
          return [] as never
        }
        if (/from settings/.test(s)) return [{ value: [{ id: 'other', en: 'Other' }] }] as never
        if (/from milestone/.test(s)) return [{ buyer_id: ID.buyerB, unit_id: ID.unit1 }] as never
        if (/select 1 from update_event where client_uuid/.test(s)) {
          log('check for a duplicate')
          if (state.gate && !state.gateUsed) { state.gateUsed = true; state.gate.reached(); await state.gate.open }
          return (committed.has(String(params[0]).toLowerCase()) ? [{ '?column?': 1 }] : []) as never
        }
        if (/^insert into note/.test(s)) { state.noteInsertAttempts++; pendingNotes.push(String(params[0])); log('write note'); return [] as never }
        if (/^savepoint/.test(s)) { savepoints.set(s.split(' ')[1]!, pendingNotes.length); return [] as never }
        if (/^rollback to savepoint/.test(s)) { pendingNotes.length = savepoints.get(s.split(' ')[3]!) ?? pendingNotes.length; log('undo note'); return [] as never }
        if (/^release savepoint/.test(s)) return [] as never
        if (/^insert into update_event/.test(s)) {
          const id = String(params[0]).toLowerCase()
          const twin = uncommitted.get(id)
          if (twin) await twin                                    // a unique key waits for an uncommitted twin
          if (committed.has(id)) { log('event already stored'); return [] as never }
          uncommitted.set(id, done); pendingEvents.push(id); log('write event')
          return [{ id }] as never
        }
        throw new Error(`the stand-in does not know: ${s.slice(0, 80)}`)
      },
    }
    return {
      tx,
      commit: () => { for (const id of pendingEvents) committed.set(id, { noteId: null }); notes.push(...pendingNotes); end() },
      abort: () => end(),
    }
  }

  const db: Db = {
    async tx(_ctx, fn) {
      const t = begin()
      try { const out = await fn(t.tx); t.commit(); return out } catch (e) { t.abort(); throw e }
    },
  }
  return { db, committed, notes, state }
}

/** Two overlapping sends of the same update: the first is held after its duplicate check until the second has done all it can. */
async function overlap(a: string, b: string) {
  const s = standIn()
  let reached!: () => void
  const reachedP = new Promise<void>((r) => { reached = r })
  let open!: () => void
  s.state.gate = { reached, open: new Promise<void>((r) => { open = r }) }
  const first = s.db.tx(SUP, (tx) => submitEvent(tx, SUP, input(a) as never, TODAY))
  await reachedP                                             // the first has checked and found nothing; it has not written yet
  const second = s.db.tx(SUP, (tx) => submitEvent(tx, SUP, input(b) as never, TODAY))
  await tick()                                               // the second goes as far as it can while the first is held
  const logBeforeRelease = [...s.state.log]
  open()
  const results = await Promise.all([first, second])
  return { s, results, logBeforeRelease }
}

describe('two overlapping sends of one update (the logic, on a stand-in for two connections)', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  it('stores one event and one note; the second request waits, then reports a duplicate', async () => {
    const { s, results } = await overlap(id, id)
    expect(results.map((r) => r.duplicate)).toEqual([false, true])
    expect(s.committed.size).toBe(1)
    expect(s.notes).toHaveLength(1)
  })

  it('the second request never even writes a note: it waits on the client id before it checks or writes anything', async () => {
    const { s, logBeforeRelease } = await overlap(id, id)
    expect(s.state.noteInsertAttempts).toBe(1)
    const second = logBeforeRelease.filter((l) => l.startsWith('tx2:'))
    expect(second.some((l) => /write/.test(l))).toBe(false)
    expect(second.some((l) => /check for a duplicate/.test(l))).toBe(false)
    expect(second.some((l) => /^tx2: lock /.test(l))).toBe(true)
    expect(second.some((l) => /got lock/.test(l))).toBe(false)
  })

  it('the lock is the first thing taken on the client id, before the duplicate check and any write', async () => {
    const { s } = await overlap(id, id)
    const first = s.state.log.filter((l) => l.startsWith('tx1:'))
    const at = (re: RegExp) => first.findIndex((l) => re.test(l))
    expect(at(/got lock/)).toBeGreaterThanOrEqual(0)
    expect(at(/got lock/)).toBeLessThan(at(/check for a duplicate/))
    expect(at(/check for a duplicate/)).toBeLessThan(at(/write note/))
    expect(at(/write note/)).toBeLessThan(at(/write event/))
  })

  it('the same id in capitals or small letters is the same lock (the database compares uuids, not spellings)', async () => {
    const { s, results } = await overlap(id, id.toUpperCase())
    expect(results.map((r) => r.duplicate)).toEqual([false, true])
    expect(s.notes).toHaveLength(1)
    const keys = s.state.log.filter((l) => / lock /.test(l) && !/got/.test(l)).map((l) => l.replace(/^tx\d+: /, ''))
    expect(new Set(keys).size).toBe(1)
  })

  it('different client ids do not wait for each other', async () => {
    const { s, results, logBeforeRelease } = await overlap(id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(results.map((r) => r.duplicate)).toEqual([false, false])
    expect(s.notes).toHaveLength(2)
    expect(logBeforeRelease.some((l) => /^tx2: got lock/.test(l))).toBe(true)
  })

  it('an update with no note is unaffected', async () => {
    const s = standIn()
    const r = await Promise.all([1, 2].map(() => s.db.tx(SUP, (tx) => submitEvent(tx, SUP, input(id, { note: undefined }) as never, TODAY))))
    expect(r.map((x) => x.duplicate).sort()).toEqual([false, true])
    expect(s.notes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- the real database (PGlite): the part that is not about timing

describe('a duplicate the caller cannot see leaves no stray note', () => {
  let pg: PGlite
  let db: Db
  beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
  beforeEach(async () => { await resetAndSeed(pg) })
  afterAll(async () => { await pg.close() })

  const notes = async () => (await pg.query<{ n: string }>('select count(*)::text as n from note')).rows[0]!.n

  it('an id already used by another unit (hidden from this supervisor by row-level security) is a duplicate and writes no note', async () => {
    const used = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await pg.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values ($1, $2, $3, 'sewing', $4, '2026-11-03', 10)`,
      [used, ID.orderGreen, ID.buyerC, ID.unit2])
    const r = await db.tx(SUP, (tx) => submitEvent(tx, SUP, input(used) as never, TODAY))
    expect(r.duplicate).toBe(true)
    expect(await notes()).toBe('0')
    expect((await pg.query(`select 1 from update_event where client_uuid = $1`, [used])).rows).toHaveLength(1)
  })

  it('a plain repeat of the same update stores one note and one event', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const a = await db.tx(SUP, (tx) => submitEvent(tx, SUP, input(id) as never, TODAY))
    const b = await db.tx(SUP, (tx) => submitEvent(tx, SUP, input(id) as never, TODAY))
    expect([a.duplicate, b.duplicate]).toEqual([false, true])
    expect(await notes()).toBe('1')
    expect((await pg.query(`select 1 from update_event where client_uuid = $1`, [id])).rows).toHaveLength(1)
  })

  it('a photo link is written once with the event: the repeat points nowhere new', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const photo = '00000000-0000-0000-0000-0000000000a9'
    await pg.query(`insert into photo (id, client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes) values ($1, gen_random_uuid(), $2, $3, 'photos/x.jpg', 'sewing', $4, '2026-11-04', 2000)`,
      [photo, ID.orderRed, ID.buyerB, ID.unit1])
    await db.tx(SUP, (tx) => submitEvent(tx, SUP, input(id, { photoId: photo }) as never, TODAY))
    await db.tx(SUP, (tx) => submitEvent(tx, SUP, input(id, { photoId: photo }) as never, TODAY))
    expect((await pg.query(`select photo_id from update_event where client_uuid = $1`, [id])).rows).toEqual([{ photo_id: photo }])
    expect(await notes()).toBe('1')
  })
})

// ---------------------------------------------------------------- real Postgres only (skipped on the default PGlite run)

describe.skipIf(!usingRealPostgres())('real Postgres: overlapping sends of one update, on separate connections', () => {
  let pg: RealPg
  beforeAll(async () => { pg = await migratedRealDb() })
  beforeEach(async () => { await resetAndSeed(pg as unknown as PGlite) })
  afterAll(async () => { await pg.close() })

  /** Holds every request at its duplicate check until all of them are there (or 400 ms pass), so they truly overlap. */
  function withBarrier(inner: Db, parties: number): Db {
    let here = 0
    let release!: () => void
    const all = new Promise<void>((r) => { release = r })
    const timer = setTimeout(release, 400)
    return {
      tx: (ctx, fn) => inner.tx(ctx, (tx) => fn({
        query: async (sql: string, params?: unknown[]) => {
          const rows = await tx.query(sql, params)
          if (/select 1 from update_event where client_uuid/.test(sql) && ++here >= parties) { clearTimeout(timer); release() }
          if (/select 1 from update_event where client_uuid/.test(sql)) await all
          return rows as never
        },
      })),
    }
  }

  it.each([2, 6])('%i sends of the same update at once store one event, one note and report all but one as duplicates', async (parties) => {
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const db = withBarrier(pg.db(), parties)
    const results = await Promise.all(Array.from({ length: parties }, () => db.tx(SUP, (tx) => submitEvent(tx, SUP, input(id) as never, TODAY))))
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1)
    expect((await pg.query('select 1 from update_event where client_uuid = $1', [id])).rows).toHaveLength(1)
    expect((await pg.query('select 1 from note')).rows).toHaveLength(1)
  })
})

// WHAT ONLY A REAL POSTGRES RUN CAN PROVE
//  1. That pg_advisory_xact_lock(hashtext(...), hashtext(...)) really makes the second connection wait until the first
//     commits, and that the second then sees the first's committed row (read committed).
//  2. That insert ... on conflict (client_uuid) do nothing waits for an uncommitted twin, as the stand-in assumes.
//  3. That the app role is allowed to call pg_advisory_xact_lock (it is a built-in granted to everyone).
// packages/server/test/realPostgres.test.ts (run in CI against Postgres 16) holds the two-connection test that sends the
// same update twice at once and counts the rows.
