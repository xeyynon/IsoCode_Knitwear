-- The review gate and buyer links.
--
-- A warning is raised by the engine, then a merchandiser confirms (and may reword) it before a
-- buyer can see it. One unresolved warning per order and stage: when the stage recovers it is
-- resolved, and a buyer never sees a resolved, dismissed or unconfirmed one.
alter table warning add column buyer_text text;        -- the wording a buyer would see; no internal figures
alter table warning add column confirmed_at timestamptz;
alter table warning add column dismissed_at timestamptz;
alter table warning add column resolved_at timestamptz;

create unique index warning_one_unresolved_per_stage on warning (order_id, stage) where resolved_at is null;

drop policy buyer_warnings on warning;
create policy buyer_warnings on warning for select using (
  app_role() = 'buyer' and buyer_id = app_buyer()
  and confirmed_by is not null and dismissed_at is null and resolved_at is null);

alter table buyer_link add column label text;
alter table buyer_link add column created_at timestamptz not null default now();
