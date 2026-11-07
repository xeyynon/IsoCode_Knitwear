-- A cleaned (purged) photo has no file any more, so a buyer must never be shown it, even if its row
-- were marked approved again. 007 added purged_at but left the buyer policy from 005 unchanged.
drop policy buyer_photos on photo;
create policy buyer_photos on photo for select using (
  app_role() = 'buyer' and buyer_id = app_buyer() and approved_by is not null and rejected_at is null and purged_at is null);
