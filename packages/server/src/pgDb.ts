import pg from 'pg'
import { CONTEXT_SQL, contextParams, errorReason, type Db } from './db.js'
import { AppError } from './errors.js'

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
      // With connectionTimeoutMillis set, a request that cannot get a connection in time fails fast: say "busy, try again" (a 503 the phone
      // retries) instead of a 500 that looks like a bug, and instead of queueing for ever.
      const client = await pool.connect().catch((e: unknown) => {
        if (e instanceof Error && /timeout exceeded when trying to connect/i.test(e.message)) throw new AppError(503, 'busy', 'The server is busy. Please try again in a moment.')
        throw e
      })
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

// ---- start-up check of the login role (BE-035)
//
// Row-level security binds only a role that is not a superuser, does not have BYPASSRLS and does not own the tables (an owner is
// bound only because 001 FORCEs it, and a superuser or BYPASSRLS role is never bound). Paste the owner's URL into DATABASE_URL
// by mistake and every policy silently stops working while /api/health still says ok. So the server asks the database who it
// is logged in as and refuses to start when the answer is any of those.

export interface RoleFacts { name: string; superuser: boolean; bypassrls: boolean; owned: number }

/** One row: the current role's name, whether it is superuser, whether it bypasses RLS, and how many tables/views it owns in public. */
export const DB_ROLE_CHECK_SQL =
  `select r.rolname::text as name, r.rolsuper as superuser, r.rolbypassrls as bypassrls,
          (select count(*)::int from pg_class c where c.relowner = r.oid and c.relnamespace = 'public'::regnamespace
              and c.relkind in ('r', 'p', 'v', 'm', 'f'))::int as owned
     from pg_roles r where r.rolname = current_user`

/** Names the variable that switches the check off. Documented for local development only; the default is on. */
export const UNSAFE_ROLE_ENV = 'ALLOW_UNSAFE_DB_ROLE'

/** `ALLOW_UNSAFE_DB_ROLE=1` is the only way to switch the check off. Unset, empty and 0 leave it on; anything else is a mistake. */
export function unsafeRoleOverride(env: Record<string, string | undefined>): boolean {
  const v = env[UNSAFE_ROLE_ENV]?.trim()
  if (!v || v === '0') return false
  if (v === '1') return true
  throw new Error(`${UNSAFE_ROLE_ENV} must be 1 (local development only) or unset, not "${v}"`)
}

/**
 * Throw (with a one-line message) when the database login is a superuser, bypasses row-level security or owns tables.
 * `query` runs the check on the same connection settings the server will use (for example pool.query(sql).rows).
 * With allowUnsafe the problem is only warned about, for a developer who runs the server on a local superuser login.
 */
export async function assertSafeDbRole(
  query: (sql: string) => Promise<RoleFacts[]>,
  opts: { allowUnsafe?: boolean; warn?: (message: string) => void } = {},
): Promise<void> {
  let row: RoleFacts | undefined
  try { row = (await query(DB_ROLE_CHECK_SQL))[0] } catch (e) { throw new Error(`Could not check the database role: ${errorReason(e)}. Refusing to start.`) }
  if (!row) throw new Error('Could not check the database role: the database did not say who it is logged in as. Refusing to start.')
  const problems: string[] = []
  if (row.superuser) problems.push('it is a superuser')
  if (row.bypassrls) problems.push('it has BYPASSRLS')
  if (Number(row.owned) > 0) problems.push(`it owns ${row.owned} ${Number(row.owned) === 1 ? 'table' : 'tables'} in schema public`)
  if (!problems.length) return
  const what = `DATABASE_URL logs in as "${row.name}", and ${problems.join(' and ')}`
  if (opts.allowUnsafe) {
    opts.warn?.(`${what}, so row-level security is NOT protecting this database. Allowed because ${UNSAFE_ROLE_ENV}=1: use this on a local development database only.`)
    return
  }
  throw new Error(`${what}, which switches off row-level security. Use the non-owner app_user login (the owner is for npm run migrate only). Refusing to start. `
    + `Local development only: ${UNSAFE_ROLE_ENV}=1 skips this check.`)
}
