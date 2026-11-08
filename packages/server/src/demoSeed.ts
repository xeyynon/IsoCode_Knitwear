// Demo data for the reviewer and the pilot walkthrough, built from the brief's sample table:
//
//   PO No       Buyer                Style                       Qty    Ex-factory  Stage      Qty done
//   B-PO-88213  Company B (UK)       Men's crew neck tee, navy   12000  2026-11-20  Stitching  6800
//   B-PO-88240  Company B (UK)       Men's polo, white            8000  2026-11-12  Finishing  5200
//   C-PO-0488   Company C (Germany)  Kids printed tee, yellow    10000  2026-11-28  Printing   3100
//
// Everything else here is an ASSUMPTION, labelled in deployment.md and README.md: the units and their names, the TNA templates and offsets, the size
// split, the daily rates that add up to each "Qty done", the four extra orders (marked ILLUSTRATIVE), the Deepavali closure, the
// Tamil notes and the demo accounts. Nothing is real: no real person, phone number, buyer or address.
//
// Separate from the test fixture (test/helpers.ts), which the tests and the browser scripts depend on and which stays as it is.
// Runs inside one transaction acting as 'system', so it works on PGlite (the local demo) and on a real Postgres (npm run seed:demo).
import { createHash } from 'node:crypto'
import { addDays, isWorking, type IsoDate, type UnitCalendar } from '@isocode/engine'
import { hashSecret } from './auth.js'
import type { Tx } from './db.js'
import { createOrder } from './orderService.js'
import { normalisePhone } from './authService.js'

/** "Today" for the demo. The brief's "Qty done" figures are read as at the end of the day before. */
export const DEMO_TODAY: IsoDate = '2026-11-06'

/** Throwaway demo credentials. Printed in deployment.md on purpose; never reuse them anywhere real. */
export const DEMO_LOGINS = {
  merchandiser: { email: 'merch@companya.test', password: 'demo knitwear 2026' },
  supervisors: [
    { phone: '90000 10001', pin: '4826', label: 'Selvi, Unit 1 (stitching and finishing)' },
    { phone: '90000 10002', pin: '5937', label: 'Murugan, Unit 2' },
    { phone: '90000 10003', pin: '6048', label: 'Kavitha, Unit 3 (printed styles)' },
  ],
} as const

/** Fixed buyer links so a reviewer can open a buyer's page straight from deployment.md. Demo only: a real link is random. */
export const DEMO_BUYER_TOKENS = { companyB: 'bl_demoCompanyB_readonly_2026', companyC: 'bl_demoCompanyC_readonly_2026' } as const

/** The name each published demo login is known by at sign-in: the email in lower case, the phone as ten digits. */
const DEMO_LOGIN_NAMES: ReadonlySet<string> = new Set([
  DEMO_LOGINS.merchandiser.email.toLowerCase(), ...DEMO_LOGINS.supervisors.map((s) => normalisePhone(s.phone)!),
])
/** Is this sign-in name (email, or ten-digit phone) one of the published demo logins? Demo mode never locks those (authService.ts). */
export const isDemoLoginName = (name: string): boolean => DEMO_LOGIN_NAMES.has(name.trim().toLowerCase())

/** The published buyer links last about ten real years, however long ago the demo day is: they are printed in deployment.md. */
export const DEMO_LINK_DAYS = 3650

const U = {
  unit1: '10000000-0000-4000-8000-000000000001',
  unit2: '10000000-0000-4000-8000-000000000002',
  unit3: '10000000-0000-4000-8000-000000000003',
  printer: '10000000-0000-4000-8000-000000000004',
  washer: '10000000-0000-4000-8000-000000000005',
}
const B = { companyB: '20000000-0000-4000-8000-000000000001', companyC: '20000000-0000-4000-8000-000000000002' }
const T = { unit1: '30000000-0000-4000-8000-000000000001', unit2: '30000000-0000-4000-8000-000000000002', printed: '30000000-0000-4000-8000-000000000003' }
const MERCH_ID = '40000000-0000-4000-8000-000000000001'

/** Deepavali falls on Sunday 8 Nov 2026; the units take the Monday off as well (assumption). */
const CLOSED: { date: IsoDate; note: string }[] = [{ date: '2026-11-09', note: 'Deepavali' }]

const plain = (stage: string, sequence: number, days: number, unit: string) => ({ stage, sequence, working_days_before: days, unit_id: unit })
const TEMPLATES = [
  { id: T.unit1, name: 'Knit tee or polo, Unit 1', offsets: [plain('Cutting', 1, 14, U.unit1), plain('Stitching', 2, 6, U.unit1), plain('Finishing', 3, 2, U.unit1), plain('Packing', 4, 0, U.unit1)] },
  { id: T.unit2, name: 'Knit tee, Unit 2', offsets: [plain('Cutting', 1, 14, U.unit2), plain('Stitching', 2, 6, U.unit2), plain('Finishing', 3, 2, U.unit2), plain('Packing', 4, 0, U.unit2)] },
  { id: T.printed, name: 'Printed tee, Unit 3 with outside printer', offsets: [plain('Cutting', 1, 16, U.unit3), plain('Printing', 2, 10, U.printer), plain('Stitching', 3, 6, U.unit3), plain('Finishing', 4, 2, U.unit3), plain('Packing', 5, 0, U.unit3)] },
]

/** One stage's history: `done` pieces made at about `rate` a day, ending on `lastDay`. The earliest day takes the remainder. */
interface StageHistory { stage: string; done: number; rate: number; lastDay?: IsoDate; note?: { text: string; daysAgo?: number } }
interface DemoOrder {
  buyer: string; po: string; style: string; colour: string; sizes: Record<string, number>; exFactory: IsoDate; template: string
  illustrative?: boolean
  history: StageHistory[]
}

const split = (total: number, shares: Record<string, number>): Record<string, number> => {
  const keys = Object.keys(shares)
  const sum = keys.reduce((a, k) => a + shares[k]!, 0)
  const out: Record<string, number> = {}
  let given = 0
  keys.forEach((k, i) => { out[k] = i === keys.length - 1 ? total - given : Math.round((total * shares[k]!) / sum); given += out[k]! })
  return out
}
const ADULT = { S: 2, M: 3, L: 3, XL: 2 }
const KIDS = { '2-3Y': 2, '4-5Y': 3, '6-7Y': 3, '8-9Y': 2 }

const ORDERS: DemoOrder[] = [
  // ---- the brief's three sample POs
  {
    buyer: B.companyB, po: 'B-PO-88240', style: "Men's polo", colour: 'White', sizes: split(8000, ADULT), exFactory: '2026-11-12', template: T.unit1,
    history: [
      { stage: 'Cutting', done: 8000, rate: 900, lastDay: '2026-10-27' },
      { stage: 'Stitching', done: 8000, rate: 700, lastDay: '2026-11-03' },
      { stage: 'Finishing', done: 5200, rate: 650, note: { text: 'இரண்டு அயர்னிங் மெஷின் பழுது. மெக்கானிக் நாளை தான் வருவார்.', daysAgo: 1 } },
    ],
  },
  {
    buyer: B.companyB, po: 'B-PO-88213', style: "Men's crew neck tee", colour: 'Navy', sizes: split(12000, ADULT), exFactory: '2026-11-20', template: T.unit1,
    history: [
      { stage: 'Cutting', done: 12000, rate: 1100, lastDay: '2026-10-31' },
      { stage: 'Stitching', done: 6800, rate: 990, note: { text: 'தீபாவளிக்கு முன்னாடியே 12 டெய்லர்கள் ஊருக்கு போயிட்டாங்க.', daysAgo: 1 } },
    ],
  },
  {
    buyer: B.companyC, po: 'C-PO-0488', style: "Kids printed tee", colour: 'Yellow', sizes: split(10000, KIDS), exFactory: '2026-11-28', template: T.printed,
    history: [
      { stage: 'Cutting', done: 10000, rate: 1250, lastDay: '2026-11-02' },
      { stage: 'Printing', done: 3100, rate: 1050, note: { text: 'பிரிண்டிங் இங்க் இன்னும் வரல. சப்ளையர் திங்கள்கிழமை தருவதாக சொல்றாங்க.', daysAgo: 2 } },
    ],
  },
  // ---- ILLUSTRATIVE extra orders, so the board shows every colour and more than one order per buyer
  {
    buyer: B.companyB, po: 'B-PO-88302', style: "Men's crew neck tee", colour: 'Grey marl', sizes: split(6000, ADULT), exFactory: '2026-12-04', template: T.unit2, illustrative: true,
    history: [{ stage: 'Cutting', done: 3600, rate: 900, note: { text: 'Power cut for two hours in the afternoon, generator also down.', daysAgo: 1 } }],
  },
  { buyer: B.companyB, po: 'B-PO-88315', style: "Women's polo", colour: 'Black', sizes: split(5000, ADULT), exFactory: '2026-12-11', template: T.unit2, illustrative: true, history: [] },
  {
    buyer: B.companyC, po: 'C-PO-0502', style: "Kids crew neck tee", colour: 'Sky blue', sizes: split(7000, KIDS), exFactory: '2026-11-24', template: T.unit2, illustrative: true,
    history: [
      { stage: 'Cutting', done: 7000, rate: 1000, lastDay: '2026-10-30' },
      { stage: 'Stitching', done: 2400, rate: 800, lastDay: '2026-10-31', note: { text: 'இன்று வேலை கொஞ்சம் மெதுவா போச்சு.', daysAgo: 1 } },
    ],
  },
  {
    buyer: B.companyC, po: 'C-PO-0511', style: "Kids printed tee", colour: 'Mint', sizes: split(4000, KIDS), exFactory: '2026-11-16', template: T.printed, illustrative: true,
    history: [
      { stage: 'Cutting', done: 4000, rate: 1000, lastDay: '2026-10-20' },
      { stage: 'Printing', done: 4000, rate: 900, lastDay: '2026-10-27' },
      { stage: 'Stitching', done: 4000, rate: 700, lastDay: '2026-11-04' },
      { stage: 'Finishing', done: 2600, rate: 900, note: { text: 'Shade variation in 300 pcs, re-checking before packing.', daysAgo: 1 } },
    ],
  },
]

const calendarOf = (): UnitCalendar => ({ days: Object.fromEntries(CLOSED.map((c) => [c.date, false])) })

/** The working days on and before `last`, newest first, enough to hold `done` at `rate` a day. */
function dailyHistory(done: number, rate: number, last: IsoDate, cal: UnitCalendar): { date: IsoDate; qty: number }[] {
  const out: { date: IsoDate; qty: number }[] = []
  let left = done, d = last
  for (let guard = 0; left > 0 && guard < 400; guard++, d = addDays(d, -1)) {
    if (!isWorking(cal, d)) continue
    // A little day-to-day wobble (deterministic) so the history looks like a floor, not a formula.
    const wobble = [0, 40, -30, 20, -50, 10][out.length % 6]!
    const qty = Math.min(left, Math.max(1, rate + wobble))
    out.push({ date: d, qty }); left -= qty
  }
  return out
}

const uuidFrom = (s: string): string => {
  const h = createHash('sha256').update(s).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Load the demo data into an empty, migrated database. `tx` must already act as 'system' inside a transaction.
 * `now` is the real time: the buyer links are measured against the real clock, not the demo day.
 */
export async function seedDemo(tx: Tx, today: IsoDate = DEMO_TODAY, now: Date = new Date()): Promise<{ orders: number; events: number; notes: number }> {
  if ((await tx.query('select 1 from orders limit 1')).length) throw new Error('The database already has orders: the demo seed only loads into an empty database')

  await tx.query(`insert into buyer (id, name, country) values ($1, 'Company B', 'UK'), ($2, 'Company C', 'Germany')`, [B.companyB, B.companyC])
  await tx.query(
    `insert into unit (id, name, type) values ($1, 'Unit 1', 'own'), ($2, 'Unit 2', 'own'), ($3, 'Unit 3', 'own'),
       ($4, 'Printing (outside)', 'subcontractor'), ($5, 'Washing (outside)', 'subcontractor')`,
    [U.unit1, U.unit2, U.unit3, U.printer, U.washer])
  for (const unit of Object.values(U)) {
    for (const c of CLOSED) await tx.query('insert into calendar_day (unit_id, date, working, note) values ($1, $2, false, $3)', [unit, c.date, c.note])
  }
  for (const t of TEMPLATES) await tx.query('insert into tna_template (id, name, offsets) values ($1, $2, $3::jsonb)', [t.id, t.name, JSON.stringify(t.offsets)])

  const m = DEMO_LOGINS.merchandiser
  await tx.query(`insert into account (id, role, email, password_hash, label) values ($1, 'merchandiser', $2, $3, 'Priya (merchandiser)')`, [MERCH_ID, m.email, hashSecret(m.password)])
  const supUnits = [U.unit1, U.unit2, U.unit3]
  for (const [i, s] of DEMO_LOGINS.supervisors.entries()) {
    await tx.query(`insert into account (role, phone, pin_hash, unit_id, label) values ('supervisor', $1, $2, $3, $4)`, [s.phone.replace(/\s/g, ''), hashSecret(s.pin), supUnits[i], s.label])
  }

  // Buyer links: about ten real years from now (N-9). They were 60 days from the demo day, but expiry is measured in real time, so they died.
  const expires = demoLinkExpiry(now)
  await tx.query(`insert into buyer_link (buyer_id, token_hash, expires_at, label) values ($1, $2, $3, 'Demo link for reviewers'), ($4, $5, $3, 'Demo link for reviewers')`,
    [B.companyB, demoTokenHash(DEMO_BUYER_TOKENS.companyB), expires, B.companyC, demoTokenHash(DEMO_BUYER_TOKENS.companyC)])

  const cal = calendarOf()
  const yesterday = (() => { let d = addDays(today, -1); while (!isWorking(cal, d)) d = addDays(d, -1); return d })()
  let events = 0, notes = 0
  for (const o of ORDERS) {
    const made = await createOrder(tx, { role: 'system' }, { buyerId: o.buyer, po: o.po, style: o.style, colour: o.colour, sizes: o.sizes, exFactory: o.exFactory, templateId: o.template }, today)
    for (const h of o.history) {
      const unit = made.milestones.find((ms) => ms.stage === h.stage)!.unitId
      const days = dailyHistory(h.done, h.rate, h.lastDay ?? yesterday, cal)
      for (const [i, day] of days.entries()) {
        let noteId: string | null = null
        // The note goes on the day it names, or on the stage's earliest day if its history is shorter than that.
        if (h.note && i === Math.min((h.note.daysAgo ?? 1) - 1, days.length - 1)) {
          noteId = uuidFrom(`note:${o.po}:${h.stage}`)
          const ta = /[஀-௿]/.test(h.note.text)
          await tx.query(
            `insert into note (id, order_id, buyer_id, stage, unit_id, taken_on, language, text_ta, text_en, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [noteId, made.orderId, o.buyer, h.stage, unit, day.date, ta ? 'ta' : 'en', ta ? h.note.text : null, ta ? null : h.note.text, `${day.date}T12:30:00Z`])
          notes++
        }
        await tx.query(
          `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, note_id, received_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [uuidFrom(`event:${o.po}:${h.stage}:${day.date}`), made.orderId, o.buyer, h.stage, unit, day.date, day.qty, noteId, `${day.date}T12:30:00Z`])
        events++
      }
    }
  }
  return { orders: ORDERS.length, events, notes }
}

const demoTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex')
const demoLinkExpiry = (now: Date): string => new Date(now.getTime() + DEMO_LINK_DAYS * 86_400_000).toISOString()

// ---- keeping a shared demo usable (N-1, N-3, N-9, S-7)
//
// The demo database lives for months and is used by many reviewers at once. Three things keep it usable:
//   ensureDemo       every production deploy: load the demo into an empty database, or put the demo accounts, PINs and links back in one that has it
//   topUpDemo        the seeded notes and warnings come back for the next reviewer; photos nobody approved are cleaned up
//   topUpDemoIfDue   the same, but only when the real day has changed since the last time (a small row in settings holds the day), so any
//                    number of instances share one top-up a day. app.ts calls it on the first review of a new day, in demo mode only.
// Each takes an advisory lock first, so two at the same moment (two deploys, or a deploy and a request) take turns.

const DEMO_LOCK = ['isocode', 'seed_demo'] as const
const TOP_UP_KEY = 'demo_topup_on'

/** The notes the seed writes: their ids are fixed (a hash of the PO and stage), so they can be found again. Nothing here needs a date. */
function demoNotes(): { id: string; text: string; language: 'ta' | 'en' }[] {
  const out: { id: string; text: string; language: 'ta' | 'en' }[] = []
  for (const o of ORDERS) for (const h of o.history) if (h.note) out.push({ id: uuidFrom(`note:${o.po}:${h.stage}`), text: h.note.text, language: /[஀-௿]/.test(h.note.text) ? 'ta' : 'en' })
  return out
}

/**
 * Put the demo accounts and the two buyer links back as the seed made them: not stopped, not locked, links open for another ten years.
 * `rehash` also writes the password and PINs again (a deploy does; the daily top-up does not, because hashing is the slow part and
 * nothing in demo mode can change one). Only rows the seed made are touched.
 */
async function reassertDemoAccess(tx: Tx, now: Date, rehash: boolean): Promise<void> {
  const state = 'disabled_at = null, failed_attempts = 0, locked_until = null'
  const m = DEMO_LOGINS.merchandiser
  await tx.query(`update account set ${state}${rehash ? ', password_hash = $2' : ''} where id = $1`, rehash ? [MERCH_ID, hashSecret(m.password)] : [MERCH_ID])
  for (const s of DEMO_LOGINS.supervisors) {
    const phone = s.phone.replace(/\s/g, '')
    await tx.query(`update account set ${state}${rehash ? ', pin_hash = $2' : ''} where role = 'supervisor' and phone = $1`, rehash ? [phone, hashSecret(s.pin)] : [phone])
  }
  const expires = demoLinkExpiry(now)
  for (const t of Object.values(DEMO_BUYER_TOKENS)) {
    await tx.query('update buyer_link set revoked_at = null, expires_at = $2 where token_hash = $1', [demoTokenHash(t), expires])
  }
}

/**
 * Give the next reviewer something to review. Notes that were reviewed (or whose AI answer failed for good) go back to the state the seed
 * wrote: their own words, no reason, no English meaning, no AI answer. A note nobody has touched is left alone, so its AI answer is not
 * thrown away and asked for again. The AI columns are found by name (`ai_...`) and set to their defaults, so a column added later is reset
 * too. Warnings that were confirmed or hidden wait for review again. Photos nobody approved after a day are cleaned up (their bytes too,
 * when they are kept in the database), so the stored total can come back under the demo's limit.
 * Notes are updated in place, never deleted: an update points at its note, and updates are append-only.
 */
export async function topUpDemo(tx: Tx): Promise<void> {
  const aiColumns = (await tx.query<{ column_name: string }>(
    `select column_name::text as column_name from information_schema.columns where table_schema = 'public' and table_name = 'note' and left(column_name, 3) = 'ai_'`)).map((r) => r.column_name)
  const resetAi = aiColumns.map((c) => `, "${c}" = default`).join('')
  for (const n of demoNotes()) {
    await tx.query(
      `update note set text_ta = $2, text_en = $3, category = null, category_by = null, confidence = null, confirmed_by = null, confirmed_at = null${resetAi}
        where id = $1 and (confirmed_by is not null or ai_status = 'failed')`,
      [n.id, n.language === 'ta' ? n.text : null, n.language === 'en' ? n.text : null])
  }
  await tx.query(
    `update warning set confirmed_by = null, confirmed_at = null, dismissed_at = null, dismissed_was_confirmed = null
      where resolved_at is null and (confirmed_by is not null or dismissed_at is not null)`)
  const old = await tx.query<{ storage_key: string }>(
    `update photo set purged_at = now(), rejected_at = coalesce(rejected_at, now())
      where approved_by is null and purged_at is null and created_at < now() - interval '1 day' returning storage_key`)
  if (old.length) await tx.query('delete from media_object where key = any($1::text[])', [old.map((r) => r.storage_key)])
}

const lockDemo = (tx: Tx) => tx.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [...DEMO_LOCK])
const markTopUp = (tx: Tx, now: Date) => tx.query(
  `insert into settings (key, value) values ($1, to_jsonb($2::text)) on conflict (key) do update set value = excluded.value`, [TOP_UP_KEY, now.toISOString().slice(0, 10)])

/**
 * The deploy step (npm run seed:demo -- --if-empty). In one transaction, behind an advisory lock (S-7: two deploys close together on an
 * empty database used to both pass the "is it empty" check, and the second one failed half way):
 *   empty database             -> load the demo ('seeded')
 *   a database the seed made   -> put the accounts, PINs and links back and top up the notes ('refreshed')
 *   any other database         -> do nothing ('skipped'): demo logins are never added to a database that holds real orders
 */
export async function ensureDemo(tx: Tx, today: IsoDate = DEMO_TODAY, now: Date = new Date()): Promise<{ action: 'seeded' | 'refreshed' | 'skipped'; orders: number; events: number; notes: number }> {
  await lockDemo(tx)
  if (!(await tx.query('select 1 from orders limit 1')).length) {
    const r = await seedDemo(tx, today, now)
    await markTopUp(tx, now)
    return { action: 'seeded', ...r }
  }
  if (!(await tx.query('select 1 from account where id = $1', [MERCH_ID])).length) return { action: 'skipped', orders: 0, events: 0, notes: 0 }
  await reassertDemoAccess(tx, now, true)
  await topUpDemo(tx)
  await markTopUp(tx, now)
  return { action: 'refreshed', orders: 0, events: 0, notes: 0 }
}

/** The once-a-day top-up of a running demo. Returns true when it ran. `now` is the real time. */
export async function topUpDemoIfDue(tx: Tx, now: Date): Promise<boolean> {
  await lockDemo(tx)
  const day = now.toISOString().slice(0, 10)
  const last = (await tx.query<{ value: unknown }>('select value from settings where key = $1', [TOP_UP_KEY]))[0]?.value
  if (last === day) return false
  if (!(await tx.query('select 1 from account where id = $1', [MERCH_ID])).length) return false   // not a database the seed made
  await reassertDemoAccess(tx, now, false)
  await topUpDemo(tx)
  await markTopUp(tx, now)
  return true
}

/** The figures the brief gives, so a test can check the seed still says what the brief says. */
export const BRIEF_SAMPLE = [
  { po: 'B-PO-88213', buyer: 'Company B', country: 'UK', style: "Men's crew neck tee", colour: 'Navy', qty: 12000, exFactory: '2026-11-20', stage: 'Stitching', done: 6800 },
  { po: 'B-PO-88240', buyer: 'Company B', country: 'UK', style: "Men's polo", colour: 'White', qty: 8000, exFactory: '2026-11-12', stage: 'Finishing', done: 5200 },
  { po: 'C-PO-0488', buyer: 'Company C', country: 'Germany', style: 'Kids printed tee', colour: 'Yellow', qty: 10000, exFactory: '2026-11-28', stage: 'Printing', done: 3100 },
] as const
