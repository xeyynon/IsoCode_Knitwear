-- A subcontractor's stage has no one to send a daily count, so a merchandiser enters it on a visit.
-- Such an update is recorded as entered on behalf, and by whom, so the board and the order page can
-- say it is low confidence. The history stays insert-only (001's trigger covers the new columns too),
-- and a count already sent keeps on_behalf = false.
alter table update_event add column on_behalf boolean not null default false;
alter table update_event add column entered_by uuid references account(id);

-- A supervisor's own count is never on behalf: they cannot mark a row as a merchandiser's entry.
-- (Staff keep the staff_all policy from 001; buyers still have no policy at all.)
drop policy sup_events_write on update_event;
create policy sup_events_write on update_event for insert with check (
  app_role() = 'supervisor' and on_behalf = false and exists (select 1 from milestone m
    where m.order_id = update_event.order_id and m.stage = update_event.stage and m.unit_id = app_unit()
      and m.unit_id = update_event.unit_id and m.buyer_id = update_event.buyer_id));
