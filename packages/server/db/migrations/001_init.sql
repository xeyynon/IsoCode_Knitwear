-- Company A order tracking: schema and row-level security.
-- Spec: md/system_architecture.md, md/security.md.
--
-- Run as the table OWNER (not as app_user). The API connects as app_user, which
-- owns nothing, is not a superuser, and is subject to every policy below
-- (FORCE ROW LEVEL SECURITY). Each request runs in a transaction that begins:
--     select set_config('app.role', '<role>', true);      -- true = transaction-local
--     select set_config('app.buyer_id', '<uuid>', true);  -- buyers
--     select set_config('app.unit_id', '<uuid>', true);   -- supervisors
-- Never use a session-level SET: it leaks to the next request on a pooled connection.
-- With nothing set, every policy evaluates to false: the schema fails closed.

do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user nologin;   -- deployment grants LOGIN and a password separately
  end if;
end $$;


create function app_role() returns text language sql stable as
  $$ select nullif(current_setting('app.role', true), '') $$;
create function app_buyer() returns uuid language sql stable as
  $$ select nullif(current_setting('app.buyer_id', true), '')::uuid $$;
create function app_unit() returns uuid language sql stable as
  $$ select nullif(current_setting('app.unit_id', true), '')::uuid $$;
-- merchandisers and the background worker (status recompute, notes) see everything
create function app_is_staff() returns boolean language sql stable as
  $$ select coalesce(app_role() in ('merchandiser', 'system'), false) $$;

-- ---------------------------------------------------------------- tables
create table buyer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text
);

create table unit (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('own', 'subcontractor'))
);

create table account (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('merchandiser', 'supervisor')),
  email text unique,
  phone text unique,
  password_hash text,
  pin_hash text,
  unit_id uuid references unit(id),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  check ((role = 'merchandiser' and email is not null) or (role = 'supervisor' and phone is not null and unit_id is not null))
);

-- Date-only: a working day is a calendar date in the unit's own calendar, no time zone.
create table calendar_day (
  unit_id uuid not null references unit(id),
  date date not null,
  working boolean not null,
  note text,
  primary key (unit_id, date)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyer(id),
  po text not null,
  style text not null,
  colour text not null,
  sizes jsonb not null default '{}',
  qty int not null check (qty > 0),
  ex_factory date not null,
  created_at timestamptz not null default now(),
  unique (buyer_id, po, style, colour)
);

create table tna_template (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- [{ "stage": "cutting", "days_before_ex_factory": 20, "unit_type": "own" }, ...]
  offsets jsonb not null
);

create table milestone (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer_id uuid not null references buyer(id),
  stage text not null,
  unit_id uuid not null references unit(id),
  planned_end date not null,
  sequence int not null,
  qty int not null check (qty >= 0),
  planned_rate numeric,
  unique (order_id, stage)
);

create table photo (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer_id uuid not null references buyer(id),
  storage_key text not null,
  approved_by uuid references account(id),
  approved_at timestamptz
);

create table note (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer_id uuid not null references buyer(id),
  audio_key text,
  text_ta text,            -- original kept beside the translation
  text_en text,
  category text,
  confidence numeric,
  confirmed_by uuid references account(id)
);

-- Append-only. client_uuid is unique so a retried send can never double-count.
create table update_event (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  order_id uuid not null references orders(id),
  buyer_id uuid not null references buyer(id),
  stage text not null,
  unit_id uuid not null references unit(id),
  date date not null,
  qty int not null check (qty >= 0),
  photo_id uuid references photo(id),
  note_id uuid references note(id),
  received_at timestamptz not null default now()
);
create index update_event_order_stage on update_event (order_id, stage, date);

create table warning (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer_id uuid not null references buyer(id),
  stage text not null,
  status text not null check (status in ('amber', 'red')),
  maths jsonb not null,
  confirmed_by uuid references account(id),
  created_at timestamptz not null default now()
);

create table date_change (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid not null,
  buyer_id uuid references buyer(id),
  field text not null,
  old text,
  new text,
  reason text not null check (length(trim(reason)) > 0),
  user_id uuid not null references account(id),
  at timestamptz not null default now()
);

create table buyer_link (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyer(id),
  token_hash text not null unique,   -- only the hash is stored
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values
  ('window_days', '5'), ('min_data_days', '3'), ('ramp_up_days', '3'),
  ('red_below', '0.9'), ('buffer_days', '2'), ('warn_within_days', '14');

create table outbox (            -- mocked email / WhatsApp alerts
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  recipient text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Insert-only history. The trigger holds even for the table owner.
create function forbid_change() returns trigger language plpgsql as
  $$ begin raise exception '% is append-only', tg_table_name; end $$;
create trigger date_change_append_only before update or delete on date_change
  for each row execute function forbid_change();
create trigger update_event_append_only before update or delete on update_event
  for each row execute function forbid_change();

-- ---------------------------------------------------------------- row-level security
do $$ declare t text; begin
  foreach t in array array['buyer','unit','account','calendar_day','orders','tna_template','milestone',
                           'photo','note','update_event','warning','date_change','buyer_link','settings','outbox']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy staff_all on %I for all using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;

-- sign-in lookups happen before the role is known: role 'auth' may read these two tables only
create policy auth_read on account for select using (app_role() = 'auth');
create policy auth_read on buyer_link for select using (app_role() = 'auth');

-- buyers: their own rows, and only what has passed the review gate
create policy buyer_self on buyer for select using (app_role() = 'buyer' and id = app_buyer());
create policy buyer_orders on orders for select using (app_role() = 'buyer' and buyer_id = app_buyer());
create policy buyer_milestones on milestone for select using (app_role() = 'buyer' and buyer_id = app_buyer());
create policy buyer_photos on photo for select
  using (app_role() = 'buyer' and buyer_id = app_buyer() and approved_by is not null);
create policy buyer_warnings on warning for select
  using (app_role() = 'buyer' and buyer_id = app_buyer() and confirmed_by is not null);
-- no buyer policy on update_event, note, date_change, settings, outbox, account: buyers see none of it

-- supervisors: their unit only
create policy sup_unit on unit for select using (app_role() = 'supervisor' and id = app_unit());
create policy sup_calendar on calendar_day for select using (app_role() = 'supervisor' and unit_id = app_unit());
create policy sup_milestones on milestone for select using (app_role() = 'supervisor' and unit_id = app_unit());
create policy sup_orders on orders for select using (
  app_role() = 'supervisor' and exists (select 1 from milestone m where m.order_id = orders.id and m.unit_id = app_unit()));
create policy sup_events_read on update_event for select using (app_role() = 'supervisor' and unit_id = app_unit());
create policy sup_events_write on update_event for insert with check (app_role() = 'supervisor' and unit_id = app_unit());
create policy sup_photo_write on photo for insert with check (
  app_role() = 'supervisor' and exists (select 1 from milestone m where m.order_id = photo.order_id and m.unit_id = app_unit()));
create policy sup_note_write on note for insert with check (
  app_role() = 'supervisor' and exists (select 1 from milestone m where m.order_id = note.order_id and m.unit_id = app_unit()));

-- ---------------------------------------------------------------- privileges
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
revoke update, delete on update_event, date_change from app_user;   -- append-only
revoke delete on orders, milestone, warning, buyer, unit from app_user;
grant execute on all functions in schema public to app_user;
