import { createHash, randomBytes } from 'node:crypto'
import { badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TOKEN_PREFIX = 'bl_'
export const DEFAULT_LINK_DAYS = 30
export const MAX_LINK_DAYS = 180

/** Only a hash is stored, so a copy of the database cannot be used to open anyone's link. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export interface CreatedLink { id: string; token: string; expiresAt: string }

/** Make a read-only link for one buyer contact. The token is returned ONCE and cannot be shown again. */
export async function createBuyerLink(tx: Tx, ctx: Ctx, input: { buyerId: string; days?: number; label?: string }, now: Date): Promise<CreatedLink> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers make buyer links')
  if (!UUID.test(String(input.buyerId))) throw badRequest('Choose a buyer')
  const days = input.days ?? DEFAULT_LINK_DAYS
  if (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS) throw badRequest(`A link can last from 1 to ${MAX_LINK_DAYS} days`)
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 80) : ''
  if (!(await tx.query('select 1 from buyer where id = $1', [input.buyerId])).length) throw notFound('No such buyer')
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const expires = new Date(now.getTime() + days * 86_400_000)
  const row = (await tx.query<{ id: string }>(
    `insert into buyer_link (buyer_id, token_hash, expires_at, label) values ($1, $2, $3, $4) returning id::text as id`,
    [input.buyerId, hashToken(token), expires.toISOString(), label || null]))[0]!
  return { id: row.id, token, expiresAt: expires.toISOString() }
}

export interface LinkRow { id: string; buyerId: string; buyerName: string; label: string | null; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean }

export async function listBuyerLinks(tx: Tx, ctx: Ctx, now: Date): Promise<LinkRow[]> {
  if (!isStaff(ctx)) throw forbidden()
  const rows = await tx.query<{ id: string; buyer_id: string; buyer_name: string; label: string | null; created_at: string; expires_at: string; revoked_at: string | null }>(
    `select l.id::text as id, l.buyer_id::text as buyer_id, b.name as buyer_name, l.label,
            to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
            to_char(l.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expires_at, l.revoked_at::text as revoked_at
       from buyer_link l join buyer b on b.id = l.buyer_id order by l.created_at desc, l.id`)
  return rows.map((r) => ({
    id: r.id, buyerId: r.buyer_id, buyerName: r.buyer_name, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at,
    revoked: r.revoked_at !== null, expired: Date.parse(r.expires_at) <= now.getTime(),
  }))
}

export async function revokeBuyerLink(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id))) throw badRequest('Invalid request')
  const done = await tx.query('update buyer_link set revoked_at = coalesce(revoked_at, now()) where id = $1 returning id', [id])
  if (!done.length) throw notFound('No such link')
}

/** Which buyer does this token open? Null for anything unknown, revoked or expired: callers must not say which. */
export async function resolveBuyerToken(tx: Tx, token: string, now: Date): Promise<string | null> {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null
  const row = (await tx.query<{ buyer_id: string }>(
    `select buyer_id::text as buyer_id from buyer_link where token_hash = $1 and revoked_at is null and expires_at > $2`,
    [hashToken(token), now.toISOString()]))[0]
  return row?.buyer_id ?? null
}

export interface BuyerOrder {
  po: string
  style: string
  colour: string
  qty: number
  exFactory: string
  milestones: { stage: string; plannedEnd: string }[]
  /** Photos a merchandiser has approved. (Photo upload is not built yet, so this is always empty for now.) */
  photos: { id: string }[]
  /** Warnings a merchandiser has confirmed. Nothing else about progress is shown to a buyer. */
  warnings: { stage: string; severity: 'attention' | 'late_risk'; text: string; since: string }[]
}
export interface BuyerView { buyer: { name: string }; orders: BuyerOrder[] }

/**
 * What one buyer sees. Everything here is read under a database role that can only reach this
 * buyer's rows, and the query adds the same filter itself, so a mistake in either would not
 * leak. No colours, rates, shortfalls, notes or other buyers' anything.
 */
export async function getBuyerView(tx: Tx, ctx: Ctx): Promise<BuyerView> {
  if (ctx.role !== 'buyer' || !ctx.buyerId) throw forbidden()
  const buyer = (await tx.query<{ name: string }>('select name from buyer where id = $1', [ctx.buyerId]))[0]
  if (!buyer) throw notFound()
  const orders = await tx.query<{ id: string; po: string; style: string; colour: string; qty: number; ex_factory: string }>(
    'select id::text as id, po, style, colour, qty, ex_factory::text as ex_factory from orders where buyer_id = $1 order by ex_factory, po', [ctx.buyerId])
  const ms = await tx.query<{ order_id: string; stage: string; planned_end: string }>(
    'select order_id::text as order_id, stage, planned_end::text as planned_end from milestone where buyer_id = $1 order by sequence', [ctx.buyerId])
  const photos = await tx.query<{ order_id: string; id: string }>('select order_id::text as order_id, id::text as id from photo where buyer_id = $1', [ctx.buyerId])
  const warns = await tx.query<{ order_id: string; stage: string; status: 'amber' | 'red'; buyer_text: string; since: string }>(
    `select order_id::text as order_id, stage, status, buyer_text,
            to_char(confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as since
       from warning where buyer_id = $1 and confirmed_by is not null and dismissed_at is null and resolved_at is null order by confirmed_at`, [ctx.buyerId])
  return {
    buyer: { name: buyer.name },
    orders: orders.map((o) => ({
      po: o.po, style: o.style, colour: o.colour, qty: o.qty, exFactory: o.ex_factory,
      milestones: ms.filter((m) => m.order_id === o.id).map((m) => ({ stage: m.stage, plannedEnd: m.planned_end })),
      photos: photos.filter((p) => p.order_id === o.id).map((p) => ({ id: p.id })),
      warnings: warns.filter((w) => w.order_id === o.id).map((w) => ({
        stage: w.stage, severity: w.status === 'red' ? 'late_risk' as const : 'attention' as const, text: w.buyer_text, since: w.since,
      })),
    })),
  }
}
