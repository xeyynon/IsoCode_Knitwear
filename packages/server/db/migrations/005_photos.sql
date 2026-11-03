-- Photos: a supervisor attaches one to an update; a merchandiser approves it before a buyer can see it.
alter table photo add column client_uuid uuid unique;        -- makes an upload idempotent: a retry returns the same photo
alter table photo add column stage text;
alter table photo add column unit_id uuid references unit(id);
alter table photo add column taken_on date;
alter table photo add column bytes int;
alter table photo add column created_at timestamptz not null default now();
alter table photo add column rejected_at timestamptz;

-- A supervisor must be able to read back the photo row they just inserted (INSERT ... RETURNING is
-- checked against the SELECT policy), for their own unit's orders only.
create policy sup_photo_read on photo for select using (
  app_role() = 'supervisor' and unit_id = app_unit());

-- A buyer sees a photo only when it is approved and has not been withdrawn.
drop policy buyer_photos on photo;
create policy buyer_photos on photo for select using (
  app_role() = 'buyer' and buyer_id = app_buyer() and approved_by is not null and rejected_at is null);
