import { EventEmitter } from 'node:events'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { pgDb } from '../src/pgDb.js'

// Stands in for pg.Client so no Postgres is needed: connects at once, answers every query empty.
class FakeClient extends EventEmitter {
  connect(cb?: (err?: Error) => void) { if (cb) { cb(); return } return Promise.resolve() }
  query() { return Promise.resolve({ rows: [] }) }
  end(cb?: () => void) { if (cb) { cb(); return } return Promise.resolve() }
}

describe('pgDb over a pool', () => {
  it('survives an idle pooled connection dropping (Postgres restart, failover, pg_terminate_backend)', async () => {
    const pool = new pg.Pool({ Client: FakeClient as never, max: 1 })
    const seen: Error[] = []
    pgDb(pool, (err) => seen.push(err))
    const client = await pool.connect()
    client.release() // now idle in the pool
    const dropped = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
    // With no 'error' listener on the pool, this emit throws and would crash the process.
    expect(() => (client as unknown as EventEmitter).emit('error', dropped)).not.toThrow()
    expect(seen).toEqual([dropped])
    expect(pool.idleCount).toBe(0) // the dead client is gone; the next query opens a fresh one
    await pool.end()
  })
})
