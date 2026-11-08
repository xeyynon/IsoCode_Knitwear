-- Hardening found by the backend audit (BE-036, BE-037, BE-039, BE-040). Nothing here changes what the application writes today.
--
-- 1. BE-036 / BE-037. 009 and 012 bound a supervisor's insert to one of their own unit's stages, and 012 added "not on behalf", but
--    left the other columns of the three insert policies free. Through a route bug or a SQL slip a supervisor session could then
--    store an already-approved photo (skipping the merchandiser's review), name any storage key (and so be served another
--    buyer's file), forge a note's confirmation or who chose its reason, forge who entered a count and when it arrived. Each policy
--    below keeps every condition it had and adds the ones that say "this is a new, unreviewed row":
--      photo        not approved, not rejected, not purged, and a storage key of the form photos/<one file name> (what savePhoto writes)
--      note         not confirmed, and the reason (if any) not marked as chosen by a merchandiser
--      update_event received_at is the time of the insert, and entered_by is empty or a supervisor account of the SAME unit
--    entered_by is the supervisor's own account id (the service writes it for every count), so it cannot be required to be null.
--    The database does not know the caller's account id, only their unit, so this cannot say "exactly the caller"; it does stop a
--    supervisor from naming a merchandiser, another unit's supervisor, or an id that is not an account. Supervisors cannot read
--    the account table, so the check is a small function that runs as the function owner (acting as the system role for the length of
--    the call, and put back before it returns) and answers yes or no for the one id it is given.
--
-- 2. BE-039. 015 backfilled dismissed_was_confirmed with a plain UPDATE. Row-level security is forced for the table owner too,
--    so run by an owner that is not a superuser (as on a managed server) it matched no rows: the same trap 014 explains. The
--    backfill is repeated here as the system role. It touches only rows still NULL, so it is safe to run again and never
--    overwrites a value the application has set since.
--
-- 3. BE-040. email was unique case-sensitively (001) while sign-in compares lower(email), so "M@x.test" and "m@x.test" could both
--    exist and sign-in took whichever came first. Make it unique ignoring case, like 014 did for names. Existing duplicates would
--    stop the deploy half-way, so they are renamed first and nothing is deleted: in each group that matches ignoring case, the
--    account that is not stopped and has the lowest id keeps its email; every other one gets ".duplicate-<first 8 of its id>"
--    added ("M@x.test.duplicate-3fa8c2d1"). That is no longer a working sign-in name, so the person it belonged to must be given a
--    new one by a merchandiser; the log line below names how many were renamed. A database the API built has none.
--
-- Row-level security is forced for the table owner too, so the data steps act as the system role, as 014 does. set_config(..., true)
-- lasts to the end of the transaction; it is put back at the end of the block.

-- ---- 1. policies

create or replace function account_is_supervisor_of(acc uuid, unit uuid) returns boolean
  language plpgsql volatile security definer set search_path = public, pg_temp
  as $$
declare
  was text := coalesce(current_setting('app.role', true), '');
  found boolean;
begin
  perform set_config('app.role', 'system', true);   -- the function owner is bound by row-level security like everyone else
  select exists (select 1 from account where id = acc and role = 'supervisor' and unit_id = unit) into found;
  perform set_config('app.role', was, true);
  return found;
end $$;
revoke all on function account_is_supervisor_of(uuid, uuid) from public;
grant execute on function account_is_supervisor_of(uuid, uuid) to app_user;

drop policy if exists sup_photo_write on photo;
create policy sup_photo_write on photo for insert with check (
  app_role() = 'supervisor'
  and approved_by is null and approved_at is null and rejected_at is null and purged_at is null
  and storage_key ~ '^photos/[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$'
  and exists (select 1 from milestone m
    where m.order_id = photo.order_id and m.stage = photo.stage and m.unit_id = app_unit()
      and m.unit_id = photo.unit_id and m.buyer_id = photo.buyer_id));

drop policy if exists sup_note_write on note;
create policy sup_note_write on note for insert with check (
  app_role() = 'supervisor'
  and confirmed_by is null and confirmed_at is null and category_by is distinct from 'merchandiser'
  and exists (select 1 from milestone m
    where m.order_id = note.order_id and m.stage = note.stage and m.unit_id = app_unit()
      and m.unit_id = note.unit_id and m.buyer_id = note.buyer_id));

drop policy if exists sup_events_write on update_event;
create policy sup_events_write on update_event for insert with check (
  app_role() = 'supervisor' and on_behalf = false
  and received_at is not distinct from now()
  and (entered_by is null or account_is_supervisor_of(entered_by, app_unit()))
  and exists (select 1 from milestone m
    where m.order_id = update_event.order_id and m.stage = update_event.stage and m.unit_id = app_unit()
      and m.unit_id = update_event.unit_id and m.buyer_id = update_event.buyer_id));

-- ---- 2 and 3. data steps, as the system role

do $$
declare
  renamed int;
begin
  perform set_config('app.role', 'system', true);

  update warning set dismissed_was_confirmed = true
   where dismissed_at is not null and dismissed_was_confirmed is null;

  update account a set email = a.email || '.duplicate-' || left(a.id::text, 8)
    from (select id, row_number() over (partition by lower(email) order by (disabled_at is not null), id) as n
            from account where email is not null) d
   where d.id = a.id and d.n > 1;
  get diagnostics renamed = row_count;
  if renamed > 0 then
    raise notice '016: % account email(s) matched another ignoring case and were renamed with ".duplicate-<id>"; give those people a new sign-in email', renamed;
  end if;

  perform set_config('app.role', '', true);
end $$;

create unique index if not exists account_email_lower_key on account (lower(email));
