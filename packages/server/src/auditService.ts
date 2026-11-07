import { badRequest, forbidden } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'

/**
 * The audit trail of account administration (migration 013). Insert-only: nothing here updates or
 * deletes, and the database would refuse it. A row is written in the same transaction as the action it
 * records, so it exists exactly when the action took effect.
 */
export type AuditAction =
  | 'supervisor_added' | 'merchandiser_added' | 'pin_reset' | 'signed_out_everywhere' | 'account_stopped' | 'account_allowed'

/** A key that could carry a secret. Refused here as well as by the table's own check. */
const SECRET_KEY = /pin|pass|secret|token|hash|credential/i
// "phoneEnd" and "unitId" are fine; the words above are not, whatever the nesting.
function assertNoSecret(value: unknown, path = 'detail'): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoSecret(v, `${path}[${i}]`)); return }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) throw new Error(`${path}.${k}: an audit detail must never hold a PIN, password or hash`)
      assertNoSecret(v, `${path}.${k}`)
    }
  }
}

export async function recordAudit(tx: Tx, actorId: string, subjectId: string | null, action: AuditAction, detail: Record<string, unknown> = {}): Promise<void> {
  assertNoSecret(detail)
  await tx.query(
    `insert into account_audit (actor_id, subject_id, action, detail) values ($1, $2, $3, $4::jsonb)`,
    [actorId, subjectId, action, JSON.stringify(detail)])
}

export const AUDIT_LIMIT = 100

export interface AuditEntry {
  id: string
  at: string
  actor: string
  subject: string | null
  subjectId: string | null
  action: AuditAction
  /** A plain-English sentence for the screen. */
  sentence: string
}

interface Row {
  id: string; at: Date | string; action: AuditAction; detail: Record<string, unknown> | null; subject_id: string | null
  actor_label: string | null; actor_email: string | null
  subject_label: string | null; subject_email: string | null; subject_phone: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nameOf = (label: string | null, email: string | null, phone: string | null = null): string =>
  label?.trim() || email || (phone ? `the phone ending ${phone.slice(-4)}` : 'an unknown account')

export function sentenceFor(action: AuditAction, actor: string, subject: string | null, detail: Record<string, unknown>): string {
  const who = subject ?? 'an account'
  const unit = typeof detail.unitName === 'string' && detail.unitName ? ` in ${detail.unitName}` : ''
  switch (action) {
    case 'supervisor_added': return `${actor} added ${who} as a supervisor${unit}.`
    case 'merchandiser_added': return `${actor} added ${who} as a merchandiser.`
    case 'pin_reset': return `${actor} reset the PIN for ${who}, which also unlocked the account and signed them out on every phone.`
    case 'signed_out_everywhere': return `${actor} signed ${who} out on every phone.`
    case 'account_stopped': return `${actor} stopped the account of ${who}.`
    case 'account_allowed': return `${actor} allowed the account of ${who} again.`
  }
}

/** The latest 100 entries, newest first; only for a merchandiser (the database also refuses everyone else). */
export async function listAudit(tx: Tx, ctx: Ctx, subject?: unknown): Promise<AuditEntry[]> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers can do this')
  let subjectId: string | null = null
  if (subject !== undefined && subject !== '') {
    if (typeof subject !== 'string' || !UUID.test(subject)) throw badRequest('Choose a person')
    subjectId = subject
  }
  const rows = await tx.query<Row>(
    `select a.id::text as id, a.at, a.action, a.detail, a.subject_id::text as subject_id,
            actor.label as actor_label, actor.email as actor_email,
            s.label as subject_label, s.email as subject_email, s.phone as subject_phone
       from account_audit a
       join account actor on actor.id = a.actor_id
       left join account s on s.id = a.subject_id
      ${subjectId ? 'where a.subject_id = $1' : ''}
      order by a.at desc, a.id desc
      limit ${AUDIT_LIMIT}`, subjectId ? [subjectId] : [])
  return rows.map((r) => {
    const actor = nameOf(r.actor_label, r.actor_email)
    const subjectName = r.subject_id ? nameOf(r.subject_label, r.subject_email, r.subject_phone) : null
    return {
      id: r.id, at: new Date(r.at).toISOString(), actor, subject: subjectName, subjectId: r.subject_id, action: r.action,
      sentence: sentenceFor(r.action, actor, subjectName, r.detail ?? {}),
    }
  })
}
