// Deterministic, clearly fake datasets for the speed-up tests (OPT-A). No random() and no clock in the data: the same
// rows, with the same ids, every time, so a board built from them can be compared with one stored earlier.
import { createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { getBoard } from '../src/boardService.js'
import { getOrderDetail } from '../src/orderDetailService.js'
import type { Ctx, Db, Tx } from '../src/db.js'

export const GEN = {
  merch: '00000000-0000-0000-0000-0000000000ee',
  units: [1, 2, 3].map((n) => `00000000-0000-0000-0000-00000000cc0${n}`),
}
export const GEN_TODAY = '2026-11-04'

/**
 * `orders` orders over 3 units and 8 buyers, 1 to 4 stages each, a few hundred update events (some on Sundays and on closed days,
 * one day in the future, some entered on behalf), and calendars with worked Sundays and closed weekdays. Call on an EMPTY database.
 */
export async function seedGenerated(pg: PGlite, orders = 300): Promise<void> {
  await pg.exec(`
    insert into unit (id, name, type) values ${GEN.units.map((id, i) => `('${id}', 'Gen unit ${i + 1}', 'own')`).join(',')};
    insert into buyer (id, name, country) select md5('b'||g)::uuid, 'Gen buyer '||g, 'XX' from generate_series(1, 8) g;
    insert into orders (id, buyer_id, po, style, colour, qty, ex_factory)
      select md5('o'||g)::uuid, md5('b'||(1 + g % 8))::uuid, 'GEN-PO-'||lpad(g::text, 4, '0'), 'style'||(g % 11), (array['navy','red','black','grey'])[1 + g % 4],
             1200 + (g % 17) * 150, date '2026-11-04' + ((g * 7) % 60) - 8
        from generate_series(1, ${orders}) g;
    insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty, planned_rate)
      select o.id, o.buyer_id, st.stage, (array[${GEN.units.map((u) => `'${u}'`).join(',')}])[1 + ((st.seq + o.rn) % 3)::int]::uuid,
             o.ex_factory - (((4 - st.seq) * 3) + (o.rn % 3))::int, st.seq, o.qty, case when o.rn % 5 = 0 then 100 + (o.rn % 7) * 40 end
        from (select id, buyer_id, qty, ex_factory, row_number() over (order by po) rn from orders) o
        cross join (values ('cutting',1),('sewing',2),('finishing',3),('packing',4)) st(stage, seq)
       where st.seq <= 1 + (o.rn % 4);
    insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, on_behalf)
      select md5('e'||g)::uuid, m.order_id, m.buyer_id, m.stage, m.unit_id,
             date '2026-11-04' + case when g % 97 = 0 then 1 else -((g * 5) % 16) end, 40 + (g * 37) % 420, g % 7 = 0
        from generate_series(1, ${orders * 9}) g
        join (select id, row_number() over (order by po) rn from orders) o on o.rn = 1 + g % ${orders}
        join milestone m on m.order_id = o.id and m.sequence = 1 + (g % 3)
       where g % 4 <> 0;
    insert into calendar_day (unit_id, date, working, note)
      select u.id, d, (extract(dow from d) = 0), 'gen'
        from unit u cross join generate_series(date '2026-09-20', date '2027-01-31', interval '1 day') d
       where (extract(dow from d) = 0 and (u.name = 'Gen unit 1' and extract(day from d)::int % 3 = 0))      -- a worked Sunday now and then
          or (extract(dow from d) = 3 and extract(day from d)::int % 5 = 0)                                    -- a closed Wednesday now and then
          or (u.name = 'Gen unit 3' and d between date '2026-11-09' and date '2026-11-11');                    -- a three-day closure (working = false on a weekday)
  `)
}

/**
 * Photos (most approved, some pending, rejected or purged) and warnings (some confirmed, some not, some dismissed or resolved) for the
 * generated orders, so a buyer's page has something to list. Deterministic ids. Needs `seedGenerated` first.
 */
export async function seedBuyerExtras(pg: PGlite): Promise<void> {
  await pg.exec(`
    insert into account (id, role, email, password_hash) values ('${GEN.merch}', 'merchandiser', 'gen-merch@example.test', 'x') on conflict do nothing;
    insert into photo (client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes, approved_by, approved_at, rejected_at, purged_at, created_at)
      select md5('p'||g)::uuid, m.order_id, m.buyer_id, 'photos/gen-'||g||'.jpg', m.stage, m.unit_id, date '2026-11-04' - (g % 9), 1000,
             case when g % 5 <> 0 then '${GEN.merch}'::uuid end, case when g % 5 <> 0 then timestamptz '2026-11-04 03:00+00' end,
             case when g % 11 = 0 then timestamptz '2026-11-04 04:00+00' end, case when g % 13 = 0 then timestamptz '2026-11-04 05:00+00' end,
             timestamptz '2026-11-01 00:00+00' + (g || ' minutes')::interval
        from generate_series(1, 900) g
        join (select id, row_number() over (order by po) rn from orders) o on o.rn = 1 + g % 300
        join milestone m on m.order_id = o.id and m.sequence = 1;
    insert into warning (order_id, buyer_id, stage, status, maths, buyer_text, confirmed_by, confirmed_at, dismissed_at, resolved_at)
      select m.order_id, m.buyer_id, m.stage, case when g % 2 = 0 then 'red' else 'amber' end, '{}'::jsonb, 'Gen text '||g,
             case when g % 4 <> 0 then '${GEN.merch}'::uuid end, case when g % 4 <> 0 then timestamptz '2026-11-03 06:00+00' + (g || ' minutes')::interval end,
             case when g % 9 = 0 then timestamptz '2026-11-04 01:00+00' end, case when g % 14 = 0 then timestamptz '2026-11-04 02:00+00' end
        from generate_series(1, 250) g
        join (select id, row_number() over (order by po) rn from orders) o on o.rn = g
        join milestone m on m.order_id = o.id and m.sequence = 1;
  `)
}

const MERCH: Ctx = { role: 'merchandiser' }
const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

/**
 * The board and every order page for `today`, reduced to counts, two hashes and the first `sample` rows in the clear.
 * `wrap` lets a test stand between the code and the database (to reorder the rows a query returns, or to record the SQL).
 */
export async function snapshot(db: Db, today: string, sample: number, wrap: (tx: Tx) => Tx = (tx) => tx) {
  const board = await db.tx(MERCH, (tx) => getBoard(wrap(tx), MERCH, today))
  const details = []
  for (const row of board) details.push(await db.tx(MERCH, (tx) => getOrderDetail(wrap(tx), MERCH, row.orderId, today)))
  const statuses = board.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})
  return {
    orders: board.length, statuses, lowConfidenceOrders: board.filter((r) => r.lowConfidenceStages.length).length,
    boardSha256: sha(board), detailsSha256: sha(details), sample: board.slice(0, sample),
  }
}
