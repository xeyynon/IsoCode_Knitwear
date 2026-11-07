import pg from 'pg'
import { CONTEXT_SQL, contextParams, type Db } from './db.js'

/**
 * Production Db over a pg pool. Connect as `app_user` (not the owner, not a superuser):
 * the policies only bind a role that does not own the tables.
 * An idle pooled connection that drops (a Postgres restart, failover, pg_terminate_backend)
 * makes the pool emit 'error'; with no listener Node would crash the process. The pool has
 * already discarded that client and opens a fresh one on the next query, so log and carry on.
 */
export function pgDb(pool: pg.Pool, onIdleError: (err: Error) => void = (err) => console.error('idle db client error', err)): Db {
  pool.on('error', (err) => onIdleError(err))
  return {
    async tx(ctx, fn) {
      const client = await pool.connect()
      // If even ROLLBACK fails the connection is dead or stuck mid-transaction: destroy the client
      // rather than hand it back to the pool for the next request to inherit.
      let broken = false
      try {
        await client.query('begin')
        await client.query(CONTEXT_SQL, contextParams(ctx))
        const out = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows as never })
        await client.query('commit')
        return out
      } catch (e) {
        await client.query('rollback').catch(() => { broken = true })
        throw e
      } finally {
        client.release(broken)
      }
    },
  }
}
