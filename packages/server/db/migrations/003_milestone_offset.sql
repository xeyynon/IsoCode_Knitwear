-- Each milestone remembers the working-day offset it was scheduled with, so changing the
-- ex-factory date can re-schedule it. Null = the date was set by hand: leave it alone.
alter table milestone add column working_days_before int check (working_days_before is null or working_days_before >= 0);
