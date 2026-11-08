import { backSchedule, type TemplateStep } from '@isocode/engine'
import { hashSecret } from './auth.js'
import { normalisePhone } from './authService.js'
import { AppError, badRequest, forbidden, notFound, orDuplicate } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { isIsoDate, isStageName } from './today.js'
import { recordAudit } from './auditService.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const staffOnly = (ctx: Ctx) => { if (!isStaff(ctx)) throw forbidden('Only merchandisers can do this') }
const uuid = (v: unknown, what: string): string => { if (typeof v !== 'string' || !UUID.test(v)) throw badRequest(`Choose ${what}`); return v }
const text = (v: unknown, what: string, max: number): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${what} is required`)
  const t = v.trim().replace(/\s+/g, ' ')
  if (t.length > max) throw badRequest(`${what} must be at most ${max} characters`)
  return t
}

// ---------------------------------------------------------------- PINs and passwords

/** A 4-digit PIN has only 10,000 values, so the obvious ones are refused: they are what a guesser tries first. */
export function weakPin(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'The PIN must be exactly 4 digits'
  const d = pin.split('').map(Number)
  if (d.every((x) => x === d[0])) return 'That PIN is too easy to guess (the same digit four times)'
  const step = d[1]! - d[0]!
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1]! === step)) return 'That PIN is too easy to guess (a run of digits)'
  if (d[0] === d[2] && d[1] === d[3]) return 'That PIN is too easy to guess (a repeated pair)'
  if (['2580', '1004', '2000', '2001', '1122', '6969', '0852', '1990', '1980'].includes(pin)) return 'That PIN is too easy to guess'
  return null
}

export function weakPassword(pw: string, email: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'The password must be at least 10 characters'
  if (pw.length > 200) return 'That password is too long'
  if (pw.toLowerCase() === email.toLowerCase() || /^(.)\1+$/.test(pw)) return 'That password is too easy to guess'
  return null
}

// ---------------------------------------------------------------- units

export interface UnitRow { id: string; name: string; type: 'own' | 'subcontractor' }

export async function listUnits(tx: Tx, ctx: Ctx): Promise<UnitRow[]> {
  staffOnly(ctx)
  return tx.query<UnitRow>('select id::text as id, name, type from unit order by name, id')
}

export async function createUnit(tx: Tx, ctx: Ctx, input: { name?: unknown; type?: unknown }): Promise<{ id: string }> {
  staffOnly(ctx)
  const name = text(input.name, 'The unit name', 80)
  if (input.type !== 'own' && input.type !== 'subcontractor') throw badRequest('Say whether the unit is your own or a subcontractor')
  const duplicate = new AppError(409, 'duplicate', 'A unit with that name already exists')
  if ((await tx.query('select 1 from unit where lower(name) = lower($1)', [name])).length) throw duplicate
  // The check above can lose a race with another request; the unique index (014) then refuses the insert and the answer is the same.
  return (await orDuplicate(() => tx.query<{ id: string }>('insert into unit (name, type) values ($1, $2) returning id::text as id', [name, input.type]), duplicate))[0]!
}

// ---------------------------------------------------------------- people

export interface AccountRow {
  id: string; role: 'merchandiser' | 'supervisor'; label: string | null; email: string | null; phoneEnd: string | null
  unitId: string | null; unitName: string | null; disabled: boolean; locked: boolean
}

/** Everyone who can sign in. A phone number is shown only by its last four digits. */
export async function listAccounts(tx: Tx, ctx: Ctx, now: Date): Promise<AccountRow[]> {
  staffOnly(ctx)
  const rows = await tx.query<{ id: string; role: 'merchandiser' | 'supervisor'; label: string | null; email: string | null; phone: string | null; unit_id: string | null; unit_name: string | null; disabled: boolean; locked: boolean }>(
    `select a.id::text as id, a.role, a.label, a.email, a.phone, a.unit_id::text as unit_id, u.name as unit_name,
            a.disabled_at is not null as disabled, coalesce(a.locked_until > $1::timestamptz, false) as locked
       from account a left join unit u on u.id = a.unit_id order by a.role, a.label nulls last, a.email nulls last, a.phone, a.id`, [now.toISOString()])
  return rows.map((r) => ({ id: r.id, role: r.role, label: r.label, email: r.email, phoneEnd: r.phone ? r.phone.slice(-4) : null, unitId: r.unit_id, unitName: r.unit_name, disabled: r.disabled, locked: r.locked }))
}

export async function createSupervisor(tx: Tx, ctx: Ctx, input: { phone?: unknown; pin?: unknown; unitId?: unknown; label?: unknown }, actorId: string): Promise<{ id: string }> {
  staffOnly(ctx)
  const phone = typeof input.phone === 'string' ? normalisePhone(input.phone) : null
  if (!phone) throw badRequest('Enter a 10-digit phone number')
  // An Indian mobile number starts with 6, 7, 8 or 9. Only when an account is made: sign-in still takes any ten digits, so a
  // supervisor who already has an account with another kind of number is never locked out by this rule.
  if (!/^[6-9]/.test(phone)) throw badRequest('Enter an Indian mobile number: ten digits starting with 6, 7, 8 or 9')
  const pin = typeof input.pin === 'string' ? input.pin : ''
  const weak = weakPin(pin)
  if (weak) throw badRequest(weak)
  const unitId = uuid(input.unitId, 'the unit this supervisor works in')
  const label = text(input.label, 'The name', 80)
  const unit = (await tx.query<{ name: string }>('select name from unit where id = $1', [unitId]))[0]
  if (!unit) throw notFound('No such unit')
  const duplicate = new AppError(409, 'duplicate', 'That phone number already has an account')
  if ((await tx.query('select 1 from account where phone = $1', [phone])).length) throw duplicate
  const made = (await orDuplicate(() => tx.query<{ id: string }>(
    `insert into account (role, phone, pin_hash, unit_id, label) values ('supervisor', $1, $2, $3, $4) returning id::text as id`,
    [phone, hashSecret(pin), unitId, label]), duplicate))[0]!
  await recordAudit(tx, actorId, made.id, 'supervisor_added', { unitId, unitName: unit.name, phoneEnd: phone.slice(-4) })
  return made
}

export async function createMerchandiser(tx: Tx, ctx: Ctx, input: { email?: unknown; password?: unknown; label?: unknown }, actorId: string): Promise<{ id: string }> {
  staffOnly(ctx)
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw badRequest('Enter a valid email address')
  const pw = typeof input.password === 'string' ? input.password : ''
  const weak = weakPassword(pw, email)
  if (weak) throw badRequest(weak)
  const label = text(input.label, 'The name', 80)
  const duplicate = new AppError(409, 'duplicate', 'That email already has an account')
  if ((await tx.query('select 1 from account where lower(email) = $1', [email])).length) throw duplicate
  const made = (await orDuplicate(() => tx.query<{ id: string }>(
    `insert into account (role, email, password_hash, label) values ('merchandiser', $1, $2, $3) returning id::text as id`,
    [email, hashSecret(pw), label]), duplicate))[0]!
  await recordAudit(tx, actorId, made.id, 'merchandiser_added')
  return made
}

/** A new PIN, which also unlocks the account and signs the person out of every phone. */
export async function resetPin(tx: Tx, ctx: Ctx, id: string, pin: unknown, actorId: string): Promise<void> {
  staffOnly(ctx)
  uuid(id, 'a person')
  const p = typeof pin === 'string' ? pin : ''
  const weak = weakPin(p)
  if (weak) throw badRequest(weak)
  const done = await tx.query(
    `update account set pin_hash = $2, failed_attempts = 0, locked_until = null, token_version = token_version + 1 where id = $1 and role = 'supervisor' returning id`, [id, hashSecret(p)])
  if (!done.length) throw notFound('No such supervisor')
  await recordAudit(tx, actorId, id, 'pin_reset')
}

/** Sign someone out on every phone at once (a lost phone, a leaver). They can sign in again unless disabled. */
export async function signOutEverywhere(tx: Tx, ctx: Ctx, id: string, actorId: string): Promise<void> {
  staffOnly(ctx)
  uuid(id, 'a person')
  const done = await tx.query('update account set token_version = token_version + 1 where id = $1 returning id', [id])
  if (!done.length) throw notFound('No such person')
  await recordAudit(tx, actorId, id, 'signed_out_everywhere')
}

/** Stop an account for good (or allow it again). A merchandiser cannot disable themselves: that could lock everyone out. */
export async function setDisabled(tx: Tx, ctx: Ctx, byUserId: string, id: string, disabled: unknown): Promise<void> {
  staffOnly(ctx)
  uuid(id, 'a person')
  if (typeof disabled !== 'boolean') throw badRequest('Say whether to stop or allow the account')
  if (id.toLowerCase() === byUserId.toLowerCase()) throw badRequest('You cannot stop your own account')
  const done = await tx.query(
    `update account set disabled_at = case when $2 then coalesce(disabled_at, now()) else null end, token_version = token_version + 1 where id = $1 returning id`, [id, disabled])
  if (!done.length) throw notFound('No such person')
  await recordAudit(tx, byUserId, id, disabled ? 'account_stopped' : 'account_allowed')
}

// ---------------------------------------------------------------- closed days (holidays, closures)

export interface DayRow { unitId: string; date: string; working: boolean; note: string | null }

/** The days a unit differs from the normal week (Sundays closed): holidays, and extra days worked. */
export async function listCalendar(tx: Tx, ctx: Ctx, unitId: string | undefined): Promise<DayRow[]> {
  staffOnly(ctx)
  if (unitId !== undefined) uuid(unitId, 'a unit')
  const rows = await tx.query<{ unit_id: string; date: string; working: boolean; note: string | null }>(
    `select unit_id::text as unit_id, date::text as date, working, note from calendar_day ${unitId ? 'where unit_id = $1' : ''} order by date, unit_id`, unitId ? [unitId] : [])
  return rows.map((r) => ({ unitId: r.unit_id, date: r.date, working: r.working, note: r.note }))
}

export async function setCalendarDay(tx: Tx, ctx: Ctx, input: { unitId?: unknown; date?: unknown; working?: unknown; note?: unknown }): Promise<void> {
  staffOnly(ctx)
  const unitId = uuid(input.unitId, 'a unit')
  if (!isIsoDate(input.date)) throw badRequest('Choose a real date')
  if (typeof input.working !== 'boolean') throw badRequest('Say whether the unit works that day')
  const note = typeof input.note === 'string' && input.note.trim() ? text(input.note, 'The note', 80) : null
  if (!(await tx.query('select 1 from unit where id = $1', [unitId])).length) throw notFound('No such unit')
  await tx.query(
    `insert into calendar_day (unit_id, date, working, note) values ($1, $2, $3, $4)
     on conflict (unit_id, date) do update set working = excluded.working, note = excluded.note`, [unitId, input.date, input.working, note])
}

/** Back to the normal week for that day. */
export async function clearCalendarDay(tx: Tx, ctx: Ctx, input: { unitId?: unknown; date?: unknown }): Promise<void> {
  staffOnly(ctx)
  const unitId = uuid(input.unitId, 'a unit')
  if (!isIsoDate(input.date)) throw badRequest('Choose a real date')
  const done = await tx.query('delete from calendar_day where unit_id = $1 and date = $2 returning date', [unitId, input.date])
  if (!done.length) throw notFound('That day has no special setting')
}

// ---------------------------------------------------------------- TNA templates

export interface TemplateStage { stage: string; workingDaysBefore: number; unitId: string }
export interface TemplateRow { id: string; name: string; stages: (TemplateStage & { unitName: string })[] }

export async function listTemplates(tx: Tx, ctx: Ctx): Promise<TemplateRow[]> {
  staffOnly(ctx)
  const units = new Map((await tx.query<{ id: string; name: string }>('select id::text as id, name from unit')).map((u) => [u.id, u.name]))
  const rows = await tx.query<{ id: string; name: string; offsets: unknown }>('select id::text as id, name, offsets from tna_template order by name, id')
  return rows.map((t) => ({
    id: t.id, name: t.name,
    stages: (Array.isArray(t.offsets) ? t.offsets as { stage: string; sequence: number; working_days_before: number; unit_id: string }[] : [])
      .sort((a, b) => a.sequence - b.sequence)
      .map((o) => ({ stage: o.stage, workingDaysBefore: o.working_days_before, unitId: o.unit_id, unitName: units.get(o.unit_id) ?? '' })),
  }))
}

/**
 * Create or change a template. The stages are given in order. Orders already created keep the dates they
 * were given: a template only decides the dates of orders created AFTER it is saved.
 */
export async function saveTemplate(tx: Tx, ctx: Ctx, input: { id?: unknown; name?: unknown; stages?: unknown }): Promise<{ id: string }> {
  staffOnly(ctx)
  const name = text(input.name, 'The template name', 80)
  if (!Array.isArray(input.stages) || input.stages.length < 1 || input.stages.length > 20) throw badRequest('A template needs between 1 and 20 stages')
  const steps: TemplateStage[] = input.stages.map((s: unknown, i: number) => {
    const o = (s ?? {}) as { stage?: unknown; workingDaysBefore?: unknown; unitId?: unknown }
    const stage = text(o.stage, `Stage ${i + 1}'s name`, 40).toLowerCase()
    // The same rule an update or a photo applies to the stage it names: a name that fails it could be saved here but never receive an update.
    if (!isStageName(stage)) throw badRequest(`Stage ${i + 1}'s name has a character that is not allowed`)
    if (!Number.isInteger(o.workingDaysBefore) || (o.workingDaysBefore as number) < 0 || (o.workingDaysBefore as number) > 365) throw badRequest(`Stage "${stage}": working days before ex-factory must be a whole number from 0 to 365`)
    return { stage, workingDaysBefore: o.workingDaysBefore as number, unitId: uuid(o.unitId, `the unit for "${stage}"`) }
  })
  // Reuse the engine's own check, so a saved template can never be one that order setup would refuse.
  const engine: TemplateStep[] = steps.map((s, i) => ({ stage: s.stage, sequence: i + 1, workingDaysBefore: s.workingDaysBefore, unitId: s.unitId }))
  // The engine's order fault names two dates worked out from a probe date nobody entered, so the order fault is said here in offsets instead
  // (the same rule: a later stage may not be further from ex-factory than the one before it). Its other faults hold no date.
  const problems = backSchedule('2031-06-20', engine, {}, '2020-01-01').problems.filter((p) => !/\d{4}-\d{2}-\d{2}/.test(p))
  let orderFault = false
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!, cur = steps[i]!
    if (cur.workingDaysBefore > prev.workingDaysBefore) {
      orderFault = true
      problems.push(`"${cur.stage}" would finish before "${prev.stage}" (${cur.workingDaysBefore} working days before ex-factory, against ${prev.workingDaysBefore})`)
    }
  }
  if (problems.length) throw badRequest(`This template does not work: ${problems.join('; ')}${orderFault ? '. List the stages in the order they happen, with the biggest number first.' : ''}`)
  const known = new Set((await tx.query<{ id: string }>('select id::text as id from unit')).map((u) => u.id))
  for (const s of steps) if (!known.has(s.unitId)) throw notFound(`No such unit for "${s.stage}"`)

  const duplicate = new AppError(409, 'duplicate', 'A template with that name already exists')
  const offsets = JSON.stringify(engine.map((s) => ({ stage: s.stage, sequence: s.sequence, working_days_before: s.workingDaysBefore, unit_id: s.unitId })))
  if (input.id !== undefined && input.id !== null) {
    const id = uuid(input.id, 'a template')
    const done = await orDuplicate(() => tx.query('update tna_template set name = $2, offsets = $3::jsonb where id = $1 returning id', [id, name, offsets]), duplicate)
    if (!done.length) throw notFound('No such template')
    return { id }
  }
  if ((await tx.query('select 1 from tna_template where lower(name) = lower($1)', [name])).length) throw duplicate
  return (await orDuplicate(() => tx.query<{ id: string }>('insert into tna_template (name, offsets) values ($1, $2::jsonb) returning id::text as id', [name, offsets]), duplicate))[0]!
}

export async function deleteTemplate(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  staffOnly(ctx)
  uuid(id, 'a template')
  const done = await tx.query('delete from tna_template where id = $1 returning id', [id])
  if (!done.length) throw notFound('No such template')
}
