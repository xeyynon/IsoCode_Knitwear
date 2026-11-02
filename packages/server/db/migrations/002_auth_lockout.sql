-- Sign-in happens before the caller's role is known. Role 'auth' may already read
-- account (001); lockout needs it to update the attempt counters too, and nothing else.
create policy auth_update on account for update
  using (app_role() = 'auth') with check (app_role() = 'auth');
