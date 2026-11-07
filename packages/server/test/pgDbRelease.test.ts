import { EventEmitter } from 'node:events'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { pgDb } from '../src/pgDb.js'

// A pg.Client stand-in that records what it was asked and can fail ROLLBACK, as a dead connection does.
let failRollback = false
class FakeClient extends EventEmitter {
  _queryable = true   // what pg-pool checks before it keeps a released client
  _ending = false
  connect(cb?: (err?: Error) => void) { if (cb) { cb(); return } return Promise.resolve() }
  query(sql: string) {
    if (sql === 'rollback' && failRollback) return Promise.reject(new Error('Connection terminated'))
    return Promise.resolve({ rows: [] })
  }
  end(cb?: () => void) { if (cb) { cb(); return } return Promise.resolve() }
}

describe('pgDb gives the connection back correctly', () => {
  it('keeps a healthy connection after a rolled-back transaction', async () => {
    failRollback = false
    const pool = new pg.Pool({ Client: FakeClient as never, max: 1 })
    const db = pgDb(pool, () => undefined)
    await expect(db.tx({ role: 'system' }, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(pool.totalCount).toBe(1)
    expect(pool.idleCount).toBe(1)
    await pool.end()
  })

  it('throws away a connection whose ROLLBACK failed, so the next request never inherits it', async () => {
    failRollback = true
    const pool = new pg.Pool({ Client: FakeClient as never, max: 1 })
    const db = pgDb(pool, () => undefined)
    await expect(db.tx({ role: 'system' }, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(pool.totalCount).toBe(0)
    failRollback = false
    await pool.end()
  })
})
