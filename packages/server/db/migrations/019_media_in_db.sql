-- Photo bytes in the database, for a host with no disk and no bucket (the review demo on Vercel). MEDIA_STORE=db.
-- The bytes are only ever read through the photo routes, which check who is asking first (photoService.ts); the store itself
-- acts as 'system', so this table has a policy for that role only: no buyer, supervisor or merchandiser session can read it
-- directly, whatever query a bug might send. Photos are shrunk on the phone first (well under 1 MB each).
create table media_object (
  key text primary key check (length(key) between 1 and 200),
  bytes bytea not null,
  created_at timestamptz not null default now()
);
alter table media_object enable row level security;
alter table media_object force row level security;
create policy system_only on media_object for all using (app_role() = 'system') with check (app_role() = 'system');
-- 001's blanket grant covered only the tables that existed then.
grant select, insert, update, delete on media_object to app_user;
