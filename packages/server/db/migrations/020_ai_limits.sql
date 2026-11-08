-- Limits on what the AI feature may cost (the free plans of the AI services answer about 30 requests a minute and 1,000 a day).
--
--   note.ai_claimed_at    set when a request takes a note to ask the AI about it, cleared when the answer (or the failure) is
--                         stored. A claim younger than the 20-second provider timeout keeps every other request away from the
--                         note, so twenty requests at once ask about each note once, not twenty times.
--   note.ai_manual_asks   how many times a merchandiser pressed "Ask again" on this note; the app stops at 3. Kept apart from
--                         ai_attempts, which counts the automatic tries (also 3).
--   note.ai_retry_after   after a rate limit, a timeout or an unreachable service (not the note's fault) the note is left alone
--                         until this time, and the failure does not use up one of its 3 automatic tries.
--   ai_budget             how many AI calls were made on each day (UTC), so a day's total is bounded whatever the number of
--                         requests. The limit itself is the setting ai_daily_budget (a number a deployment may override with
--                         the AI_DAILY_BUDGET variable).
--
-- Row-level security is forced for the table owner too, so the data step acts as the system role (as 014 and 016 do);
-- set_config(..., true) lasts to the end of the transaction and is put back at the end of the block.
-- The new table has the same policy as the other staff tables: merchandisers (and the system role) only; supervisors and
-- buyers can neither read nor write it.
alter table note add column ai_claimed_at timestamptz;
alter table note add column ai_manual_asks int not null default 0 check (ai_manual_asks >= 0);
alter table note add column ai_retry_after timestamptz;

create table ai_budget (
  day date primary key,
  calls int not null default 0 check (calls >= 0)
);
alter table ai_budget enable row level security;
alter table ai_budget force row level security;
create policy staff_all on ai_budget for all using (app_is_staff()) with check (app_is_staff());
-- 001's blanket grant covered only the tables that existed then.
grant select, insert, update, delete on ai_budget to app_user;

do $$ begin
perform set_config('app.role', 'system', true);
insert into settings (key, value) values ('ai_daily_budget', '300') on conflict (key) do nothing;
perform set_config('app.role', '', true);
end $$;
