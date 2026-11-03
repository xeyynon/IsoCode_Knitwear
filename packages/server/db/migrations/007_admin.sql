-- The admin side: who can sign in, and being able to stop them.
--
-- token_version: every sign-in token carries the version it was made at. Raising the version signs the
-- person out on every phone at once (a lost phone, a leaver). disabled_at stops an account for good.
alter table account add column token_version int not null default 0;
alter table account add column disabled_at timestamptz;
alter table account add column label text;          -- "Ravi, Unit 1": how a merchandiser recognises the person

-- Photos a merchandiser rejected can be cleared from storage after a while. The row stays (an update may
-- point at it); only the file goes.
alter table photo add column purged_at timestamptz;

-- Sign-in reads the version and the disabled flag before the caller's role is known (role 'auth').
-- 'auth' already may read and update account (002); nothing more is needed here.
