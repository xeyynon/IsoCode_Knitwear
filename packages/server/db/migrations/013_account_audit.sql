-- An audit trail of account administration: who added someone, reset a PIN, signed someone out
-- everywhere, stopped or allowed an account, and when. It is written in the same transaction as the
-- action, so an action that fails writes nothing and an action that succeeds cannot go unrecorded.
--
-- Insert-only, like date_change: the app may add rows and (as a merchandiser) read them, never change
-- or remove one. There is no staff_all policy here on purpose: that policy also lets the 'system' role
-- in and covers update and delete. Buyers, supervisors and the sign-in ('auth') role have no policy at
-- all, so forced row-level security leaves them zero rows.
--
-- detail holds facts about the action (the unit a supervisor was added to, the last four digits of a
-- phone number), NEVER a PIN, password or hash. The service refuses such a key and the table does too.
create table account_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid not null references account(id),
  subject_id uuid references account(id),
  action text not null check (action in ('supervisor_added', 'merchandiser_added', 'pin_reset', 'signed_out_everywhere', 'account_stopped', 'account_allowed')),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object'
           and not (detail ?| array['pin', 'password', 'secret', 'token', 'hash', 'pin_hash', 'password_hash', 'pinHash', 'passwordHash']))
);
create index account_audit_newest on account_audit (at desc, id);
create index account_audit_subject on account_audit (subject_id, at desc);

-- Holds even for the table owner (the same function that protects date_change).
create trigger account_audit_append_only before update or delete on account_audit
  for each row execute function forbid_change();

alter table account_audit enable row level security;
alter table account_audit force row level security;

create policy merch_read on account_audit for select using (app_role() = 'merchandiser');
create policy merch_insert on account_audit for insert with check (app_role() = 'merchandiser');

-- 001's blanket grant covered only the tables that existed then.
grant select, insert on account_audit to app_user;
