import pg from 'pg'
import { CONTEXT_SQL, contextParams, type Db } from './db.js'

/**
 * Production Db over a pg pool. Connect as `app_user` (not the owner, not a superuser):
 * the policies only bind a role that does not own the tables.
 */
export function pgDb(pool: pg.Pool): Db {
  return {
    async tx(ctx, fn) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(CONTEXT_SQL, contextParams(ctx))
        const out = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows as never })
        await client.query('commit')
        return out
      } catch (e) {
        await client.query('rollback').catch(() => undefined)
        throw e
      } finally {
        client.release()
      }
    },
  }
}
