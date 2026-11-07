-- A supervisor may write a count, photo or note only for one of their own unit's stages, and the
-- row's order, stage, unit and buyer must be that stage's. 001 checked only the unit (events) or
-- that the unit ran some stage of the order (photos, notes), so only the service code kept a row
-- from carrying another unit's order or another buyer's id. A photo or note with no stage is refused.
drop policy sup_events_write on update_event;
create policy sup_events_write on update_event for insert with check (
  app_role() = 'supervisor' and exists (select 1 from milestone m
    where m.order_id = update_event.order_id and m.stage = update_event.stage and m.unit_id = app_unit()
      and m.unit_id = update_event.unit_id and m.buyer_id = update_event.buyer_id));

drop policy sup_photo_write on photo;
create policy sup_photo_write on photo for insert with check (
  app_role() = 'supervisor' and exists (select 1 from milestone m
    where m.order_id = photo.order_id and m.stage = photo.stage and m.unit_id = app_unit()
      and m.unit_id = photo.unit_id and m.buyer_id = photo.buyer_id));

drop policy sup_note_write on note;
create policy sup_note_write on note for insert with check (
  app_role() = 'supervisor' and exists (select 1 from milestone m
    where m.order_id = note.order_id and m.stage = note.stage and m.unit_id = app_unit()
      and m.unit_id = note.unit_id and m.buyer_id = note.buyer_id));
