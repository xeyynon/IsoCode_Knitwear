// Demo data for the reviewer and the pilot walkthrough, built from the brief's sample table:
//
//   PO No       Buyer                Style                       Qty    Ex-factory  Stage      Qty done
//   B-PO-88213  Company B (UK)       Men's crew neck tee, navy   12000  2026-11-20  Stitching  6800
//   B-PO-88240  Company B (UK)       Men's polo, white            8000  2026-11-12  Finishing  5200
//   C-PO-0488   Company C (Germany)  Kids printed tee, yellow    10000  2026-11-28  Printing   3100
//
// Everything else here is an ASSUMPTION, labelled in the TDD: the units and their names, the TNA templates and offsets, the size
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
      { stage: 'Stitching', done: 2400, rate: 800, lastDay: '2026-10-31', note: { text: 'இன்று வேலை கொஞ்சம் மெதுவா போச்சு.', daysAgo: 6 } },
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

/** Load the demo data into an empty, migrated database. `tx` must already act as 'system' inside a transaction. */
export async function seedDemo(tx: Tx, today: IsoDate = DEMO_TODAY): Promise<{ orders: number; events: number; notes: number }> {
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

  // Buyer links: valid for 60 days from the demo's today.
  const expires = `${addDays(today, 60)}T00:00:00Z`
  await tx.query(`insert into buyer_link (buyer_id, token_hash, expires_at, label) values ($1, $2, $3, 'Demo link for reviewers'), ($4, $5, $3, 'Demo link for reviewers')`,
    [B.companyB, createHash('sha256').update(DEMO_BUYER_TOKENS.companyB).digest('hex'), expires, B.companyC, createHash('sha256').update(DEMO_BUYER_TOKENS.companyC).digest('hex')])

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
        if (h.note && i === (h.note.daysAgo ?? 1) - 1) {
          noteId = uuidFrom(`note:${o.po}:${h.stage}`)
          const ta = /[஀-௿]/.test(h.note.text)
          await tx.query(
            `insert into note (id, order_id, buyer_id, stage, unit_id, taken_on, language, text_ta, text_en) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [noteId, made.orderId, o.buyer, h.stage, unit, day.date, ta ? 'ta' : 'en', ta ? h.note.text : null, ta ? null : h.note.text])
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

/** The figures the brief gives, so a test can check the seed still says what the brief says. */
export const BRIEF_SAMPLE = [
  { po: 'B-PO-88213', buyer: 'Company B', country: 'UK', style: "Men's crew neck tee", colour: 'Navy', qty: 12000, exFactory: '2026-11-20', stage: 'Stitching', done: 6800 },
  { po: 'B-PO-88240', buyer: 'Company B', country: 'UK', style: "Men's polo", colour: 'White', qty: 8000, exFactory: '2026-11-12', stage: 'Finishing', done: 5200 },
  { po: 'C-PO-0488', buyer: 'Company C', country: 'Germany', style: 'Kids printed tee', colour: 'Yellow', qty: 10000, exFactory: '2026-11-28', stage: 'Printing', done: 3100 },
] as const
