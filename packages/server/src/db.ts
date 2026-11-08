// Database access. Every piece of work happens inside one transaction that starts by
// stating who is asking. The row-level security policies (db/migrations/001_init.sql)
// read that statement. set_config(..., true) is transaction-local: it can never leak
// to the next request on a pooled connection, which a session-level SET would.
export type Role = 'merchandiser' | 'supervisor' | 'buyer' | 'system' | 'auth'

export interface Ctx {
  role: Role
  buyerId?: string   // required for buyers
  unitId?: string    // required for supervisors
}

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface Db {
  tx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T>
}

export const CONTEXT_SQL =
  `select set_config('app.role', $1, true), set_config('app.buyer_id', $2, true), set_config('app.unit_id', $3, true)`

export function contextParams(ctx: Ctx): string[] {
  if (ctx.role === 'buyer' && !ctx.buyerId) throw new Error('a buyer context needs buyerId')
  if (ctx.role === 'supervisor' && !ctx.unitId) throw new Error('a supervisor context needs unitId')
  return [ctx.role, ctx.buyerId ?? '', ctx.unitId ?? '']
}

export const isStaff = (ctx: Ctx): boolean => ctx.role === 'merchandiser' || ctx.role === 'system'

/**
 * Why an operation failed, in words, for a log line or a start-up message. `error.message` alone can be empty: Node 20 raises an
 * AggregateError with no message when a connection to `localhost` fails on both IPv6 and IPv4. So fall back to the error code,
 * then to the messages (or codes) of the errors inside it.
 */
export function errorReason(e: unknown): string {
  if (typeof e === 'string') return e.trim() || 'unknown error'
  if (typeof e !== 'object' || e === null) return 'unknown error'
  const err = e as { message?: unknown; code?: unknown; errors?: unknown }
  if (typeof err.message === 'string' && err.message.trim()) return err.message.trim()
  if (typeof err.code === 'string' && err.code) return err.code
  if (Array.isArray(err.errors)) {
    const inner = [...new Set(err.errors.map((x) => errorReason(x)).filter((x) => x !== 'unknown error'))]
    if (inner.length) return inner.join('; ')
  }
  return 'unknown error'
}
