import { forbidden } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'

/**
 * MOCKED alerts. These rows say what would be emailed or sent on WhatsApp; nothing is sent anywhere.
 * `recipient` is a label (a buyer's name, or "Merchandisers"), never a real address. A row is written
 * in the same transaction as the change it reports, so it exists exactly when the change does.
 */
export interface OutboxRow {
  channel: 'email' | 'whatsapp'
  recipientKind: 'buyer' | 'merchandiser'
  recipient: string
  subject: string
  body: string
  orderId: string
}

export async function writeOutbox(tx: Tx, row: OutboxRow): Promise<void> {
  await tx.query(
    // clock_timestamp(), not the default now(): now() is the start of the transaction, so every alert one refresh writes would share
    // a time and "newest first" would be left to chance. This is the moment of writing, so the order of writing is the order of the list.
    `insert into outbox (channel, recipient_kind, recipient, subject, body, order_id, created_at) values ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [row.channel, row.recipientKind, row.recipient, row.subject, row.body, row.orderId])
}

export const MERCHANDISERS_LABEL = 'Merchandisers'
export const OUTBOX_LIMIT = 50

/** What a buyer is told when a photo is approved. Says nothing about progress or figures. */
export function photoAlertBody(po: string, stage: string | null): string {
  return stage ? `A new photo of ${stage} for PO ${po} is ready for you to see.` : `A new photo for PO ${po} is ready for you to see.`
}

export interface OutboxItem {
  id: string
  channel: 'email' | 'whatsapp'
  recipientKind: 'buyer' | 'merchandiser'
  recipient: string
  subject: string
  body: string
  orderId: string | null
  po: string | null
  createdAt: string
}

/** The latest alerts, newest first. Merchandisers only: the outbox has no policy for anyone else. */
export async function listOutbox(tx: Tx, ctx: Ctx): Promise<OutboxItem[]> {
  if (!isStaff(ctx)) throw forbidden('The alerts list is for merchandisers')
  const rows = await tx.query<{
    id: string; channel: 'email' | 'whatsapp'; recipient_kind: 'buyer' | 'merchandiser'; recipient: string; subject: string; body: string
    order_id: string | null; po: string | null; created_at: string
  }>(
    `select x.id::text as id, x.channel, x.recipient_kind, x.recipient, x.subject, x.body, x.order_id::text as order_id, o.po,
            to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from outbox x left join orders o on o.id = x.order_id
      order by x.created_at desc, x.id desc limit ${OUTBOX_LIMIT}`)
  return rows.map((r) => ({
    id: r.id, channel: r.channel, recipientKind: r.recipient_kind, recipient: r.recipient, subject: r.subject, body: r.body,
    orderId: r.order_id, po: r.po, createdAt: r.created_at,
  }))
}
