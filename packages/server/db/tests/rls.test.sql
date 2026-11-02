-- Row-level security tests. Run after 001_init.sql, as the owner, by packages/server/test/rls.test.ts (npm test).
-- Every check raises an exception on failure, so ON_ERROR_STOP makes the run fail.
\set ON_ERROR_STOP on

-- ------------------------------------------------ fixtures (owner bypass is off: FORCE RLS applies,
-- so the fixture session acts as 'system')
begin;
select set_config('app.role', 'system', true);

insert into buyer (id, name, country) values
  ('00000000-0000-0000-0000-0000000000b1', 'Buyer B', 'DE'),
  ('00000000-0000-0000-0000-0000000000c1', 'Buyer C', 'FR');
insert into unit (id, name, type) values
  ('00000000-0000-0000-0000-00000000aa01', 'Unit 1', 'own'),
  ('00000000-0000-0000-0000-00000000aa02', 'Unit 2', 'own');
insert into account (id, role, email) values
  ('00000000-0000-0000-0000-0000000000ee', 'merchandiser', 'm@example.test');
insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'B-1', 's', 'red', 1000, '2026-11-20'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'C-1', 's', 'red', 1000, '2026-11-20');
insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', '00000000-0000-0000-0000-00000000aa01', '2026-11-11', 1, 1000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'sewing', '00000000-0000-0000-0000-00000000aa02', '2026-11-11', 1, 1000);
insert into photo (order_id, buyer_id, storage_key, approved_by) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'approved-b', '00000000-0000-0000-0000-0000000000ee'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'unapproved-b', null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'approved-c', '00000000-0000-0000-0000-0000000000ee');
insert into warning (order_id, buyer_id, stage, status, maths, confirmed_by) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', 'red', '{}', '00000000-0000-0000-0000-0000000000ee'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', 'amber', '{}', null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'sewing', 'red', '{}', '00000000-0000-0000-0000-0000000000ee');
insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', '00000000-0000-0000-0000-00000000aa01', '2026-11-03', 350);
commit;

-- ------------------------------------------------ helper: assert a count under a given identity
create or replace function test_expect(label text, got bigint, want bigint) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, wanted %', label, got, want; end if;
  raise notice 'ok   %', label;
end $$;
grant execute on function test_expect(text, bigint, bigint) to app_user;

-- ------------------------------------------------ no identity at all: fails closed
begin;
set local role app_user;
select test_expect('no role set: orders', (select count(*) from orders), 0);
select test_expect('no role set: update_event', (select count(*) from update_event), 0);
select test_expect('no role set: account', (select count(*) from account), 0);
rollback;

-- ------------------------------------------------ buyer B
begin;
set local role app_user;
select set_config('app.role', 'buyer', true), set_config('app.buyer_id', '00000000-0000-0000-0000-0000000000b1', true);
select test_expect('buyer B sees only own orders', (select count(*) from orders), 1);
select test_expect('buyer B cannot fetch C order by id', (select count(*) from orders where id = '00000000-0000-0000-0000-0000000000d2'), 0);
select test_expect('buyer B sees only own milestones', (select count(*) from milestone), 1);
select test_expect('buyer B sees only approved photos', (select count(*) from photo), 1);
select test_expect('buyer B sees only confirmed warnings', (select count(*) from warning), 1);
select test_expect('buyer B sees no update events', (select count(*) from update_event), 0);
select test_expect('buyer B sees no notes', (select count(*) from note), 0);
select test_expect('buyer B sees no date changes', (select count(*) from date_change), 0);
select test_expect('buyer B sees no settings', (select count(*) from settings), 0);
select test_expect('buyer B sees no accounts', (select count(*) from account), 0);
select test_expect('buyer B sees only itself', (select count(*) from buyer), 1);
select test_expect('counts do not leak: total orders', (select count(*) from orders), 1);
rollback;

-- a buyer cannot write
do $$ begin
  begin
    set local role app_user;
    perform set_config('app.role', 'buyer', true);
    perform set_config('app.buyer_id', '00000000-0000-0000-0000-0000000000b1', true);
    insert into orders (buyer_id, po, style, colour, qty, ex_factory)
      values ('00000000-0000-0000-0000-0000000000b1', 'X', 's', 'c', 1, '2026-12-01');
    raise exception 'FAIL buyer inserted an order';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   buyer cannot insert orders (%)', sqlerrm;
  end;
end $$;

-- ------------------------------------------------ supervisor of unit 1
begin;
set local role app_user;
select set_config('app.role', 'supervisor', true), set_config('app.unit_id', '00000000-0000-0000-0000-00000000aa01', true);
select test_expect('supervisor sees orders of own unit only', (select count(*) from orders), 1);
select test_expect('supervisor sees own unit milestones only', (select count(*) from milestone), 1);
select test_expect('supervisor sees no warnings', (select count(*) from warning), 0);
select test_expect('supervisor sees no accounts', (select count(*) from account), 0);
insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', '00000000-0000-0000-0000-00000000aa01', '2026-11-04', 360);
select test_expect('supervisor can add an event for own unit', (select count(*) from update_event), 2);
rollback;

do $$ begin
  begin
    set local role app_user;
    perform set_config('app.role', 'supervisor', true);
    perform set_config('app.unit_id', '00000000-0000-0000-0000-00000000aa01', true);
    insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
      values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'sewing', '00000000-0000-0000-0000-00000000aa02', '2026-11-04', 1);
    raise exception 'FAIL supervisor wrote an event for another unit';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   supervisor cannot write for another unit (%)', sqlerrm;
  end;
end $$;

-- a retried send with the same client_uuid is rejected, never double-counted
do $$ declare u uuid := gen_random_uuid(); begin
  begin
    set local role app_user;
    perform set_config('app.role', 'supervisor', true);
    perform set_config('app.unit_id', '00000000-0000-0000-0000-00000000aa01', true);
    insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
      values (u, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', '00000000-0000-0000-0000-00000000aa01', '2026-11-04', 5);
    insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
      values (u, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', '00000000-0000-0000-0000-00000000aa01', '2026-11-04', 5);
    raise exception 'FAIL duplicate client_uuid accepted';
  exception when unique_violation then
    raise notice 'ok   duplicate client_uuid rejected';
  end;
end $$;

-- ------------------------------------------------ append-only history, even for staff
do $$ begin
  begin
    set local role app_user;
    perform set_config('app.role', 'merchandiser', true);
    insert into date_change (entity, entity_id, field, old, new, reason, user_id)
      values ('orders', '00000000-0000-0000-0000-0000000000d1', 'ex_factory', '2026-11-20', '2026-11-25', 'buyer asked', '00000000-0000-0000-0000-0000000000ee');
    update date_change set reason = 'edited';
    raise exception 'FAIL date_change was updated';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   date_change cannot be updated (%)', sqlerrm;
  end;
end $$;

do $$ begin
  begin
    set local role app_user;
    perform set_config('app.role', 'merchandiser', true);
    insert into date_change (entity, entity_id, field, old, new, reason, user_id)
      values ('orders', '00000000-0000-0000-0000-0000000000d1', 'ex_factory', '1', '2', '   ', '00000000-0000-0000-0000-0000000000ee');
    raise exception 'FAIL date change without a reason accepted';
  exception when check_violation then
    raise notice 'ok   a date change needs a reason';
  end;
end $$;

-- the trigger is a second layer: it holds for the table owner too, who has the privilege
insert into date_change (entity, entity_id, field, old, new, reason, user_id)
  values ('orders', '00000000-0000-0000-0000-0000000000d1', 'ex_factory', 'a', 'b', 'owner insert', '00000000-0000-0000-0000-0000000000ee');
do $$ begin
  begin
    update date_change set reason = 'edited by owner';
    raise exception 'FAIL owner updated date_change';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   date_change is append-only even for the owner (%)', sqlerrm;
  end;
  begin
    delete from update_event;
    raise exception 'FAIL owner deleted update_event';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- ------------------------------------------------ sign-in role: reads and updates accounts, nothing else
begin;
set local role app_user;
select set_config('app.role', 'auth', true);
select test_expect('auth role can look up an account', (select count(*) from account), 1);
select test_expect('auth role sees no orders', (select count(*) from orders), 0);
select test_expect('auth role sees no events', (select count(*) from update_event), 0);
select test_expect('auth role sees no buyers', (select count(*) from buyer), 0);
update account set failed_attempts = 3;
select test_expect('auth role can update the lockout counter', (select count(*) from account where failed_attempts = 3), 1);
rollback;

-- an update that row-level security filters to zero rows succeeds silently, so check the table afterwards as the owner
begin;
set local role app_user;
select set_config('app.role', 'auth', true);
update orders set qty = 1;
delete from calendar_day;
commit;
select test_expect('orders untouched by the auth role', (select count(*) from orders where qty = 1), 0);
select test_expect('the fixture event is still there', (select count(*) from update_event), 1);

-- ------------------------------------------------ staff sees everything
begin;
set local role app_user;
select set_config('app.role', 'merchandiser', true);
select test_expect('merchandiser sees all orders', (select count(*) from orders), 2);
select test_expect('merchandiser sees unapproved photos', (select count(*) from photo), 3);
rollback;

-- ------------------------------------------------ the app role owns nothing and cannot bypass
select test_expect('app_user is not superuser', (select count(*) from pg_roles where rolname = 'app_user' and rolsuper), 0);
select test_expect('app_user does not bypass RLS', (select count(*) from pg_roles where rolname = 'app_user' and rolbypassrls), 0);
select test_expect('every table has RLS forced',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity), 0);

drop function test_expect(text, bigint, bigint);
