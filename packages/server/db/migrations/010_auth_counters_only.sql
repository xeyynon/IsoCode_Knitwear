-- 002 let role 'auth' update any column of account, though lockout needs only the attempt counters.
-- RLS cannot limit columns, and every role shares one login, so a trigger does it: under 'auth' a change
-- to anything but failed_attempts and locked_until is refused. Columns added later are covered too.
create function account_auth_counters_only() returns trigger language plpgsql as $$
begin
  if app_role() = 'auth'
     and to_jsonb(new) - 'failed_attempts' - 'locked_until' is distinct from to_jsonb(old) - 'failed_attempts' - 'locked_until' then
    raise exception 'role auth may change only the sign-in attempt counters';
  end if;
  return new;
end $$;
create trigger account_auth_counters_only before update on account
  for each row execute function account_auth_counters_only();
