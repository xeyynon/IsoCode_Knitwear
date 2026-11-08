-- Four indexes for reads that scan a whole table today (optimisation O-14). Each was measured with EXPLAIN ANALYZE on a generated
-- database of 3,000 orders, 12,000 milestones, 5,000 photos and 2,000 notes (see the OPT-A report): a sequential scan that throws away
-- almost every row, against an index scan that reads only the rows asked for. At pilot size the tables are small and nothing
-- changes that anyone can see; the point is that these reads must not grow with the whole history.
--
--   milestone (buyer_id)               the buyer's page and the Excel export: `where buyer_id = $1`
--   photo (buyer_id, taken_on) partial the same page's photo list: only the approved, not rejected, not purged photos are in the index,
--                                      the same condition the query states, so the index is also small
--   date_change (entity, entity_id)    the order page's history: `entity = 'orders' and entity_id = $1`, and the milestone branch
--   note (order_id, created_at desc, id)  the order page's notes, newest first
--
-- Not added, because the measurement did not support it: indexes for the review queues (pending photos and notes: the planner still
-- chose the scan while a large share of the rows were pending), for milestone(unit_id) (a supervisor reads a fifth of the table),
-- and one on update_event(order_id, date, client_uuid) (the planner never used it).
--
-- Nothing here touches data, roles, grants or row-level security. An index needs only the table's owner, so the migration runs as a
-- plain (non-superuser) owner like every other, and the app role neither creates nor drops one. IF NOT EXISTS makes a re-run harmless.
-- They are built plainly (not CONCURRENTLY, which cannot run inside the migration's transaction); at this size that takes milliseconds.
create index if not exists milestone_buyer on milestone (buyer_id);

create index if not exists photo_buyer_approved on photo (buyer_id, taken_on)
  where approved_by is not null and rejected_at is null and purged_at is null;

create index if not exists date_change_entity on date_change (entity, entity_id);

create index if not exists note_order_newest on note (order_id, created_at desc, id);
