# Bug log (backend)

Opened 2026-11-08. Scope: `packages/engine`, `packages/server`, `scripts`, `.github`, docs about them. Screens (`packages/web`, `packages/design`, `uiux`) are the UI session's and are not in this log.

How this log works
- Every bug here was **reproduced** by a finder before it was written down (a script or a failing call, with the observed and the expected result). A finder who could not reproduce something put it under "Not confirmed" at the bottom instead.
- `BE-nnn` is the id used in `bugfixed.md`, in commit messages and in test names. Ids are never reused.
- Severity: **S0** cosmetic or wording, **S1** minor wrong behaviour, **S2** wrong result for a user or a hole that needs a second mistake to hurt, **S3** could leak a secret, lose data or ship a wrong release.
- Status: `open`, `fixed` (the fix and its test are in `bugfixed.md`), `deferred` (reason given).
- Finder tags: A = engine and services, B = security and database, C = tooling and the quality net, O = optimisation audit. A bug found twice carries both tags and is one row.
- Rule for fixing (see `bugfixed.md`): the failing test comes first, then the fix; before changing code near an earlier fix, read that fix's entry and keep its test passing.

## Engine, dates and settings

| ID | Sev | Where | What is wrong | Found | Status |
| --- | --- | --- | --- | --- | --- |
| BE-001 | S2 | `engine/src/index.ts` (days to finish) | A stage exactly on pace is projected one working day late because `ceil(4520 / 301.3333333333333)` is 16, not 15. It can turn false red, raise a red warning and an alert. | A-1 | fixed |
| BE-002 | S2 | `engine/src/dates.ts`, `today.ts` | One far-future ex-factory date (`9999-12-31`) is accepted; every board load and every update send then walks every day, blocking the whole server for about 53 s. | A-3 | fixed |
| BE-003 | S1 | `engine/src/dates.ts`, `today.ts` | Years 0000 to 0099 are accepted as dates and then silently read as 19xx, so a typo gives garbage milestone dates. | A-5 | fixed |
| BE-004 | S1 | `server/src/confidence.ts` | The "low confidence" flag looks at a different set of days from the one the rate uses: it can miss an on-behalf figure the rate rests on and flag one the rate ignores. | A-4 | fixed |
| BE-005 | S1 | `server/src/engineData.ts` | Settings are not range-checked: `window_days = 0` makes the rate NaN and a stage far behind reads green; a JSON null becomes 0. | A-10 | fixed |
| BE-006 | S1 | `server/src/orderDetailService.ts` | The order page's closed-day list stops after 400 days. | A-11 | fixed |
| BE-007 | S0 | `engine/src/index.ts` (reason text) | The words "90%" and "2 working days" are fixed in the text although the thresholds are settings. | A-18 | fixed |
## Services and API behaviour

| ID | Sev | Where | What is wrong | Found | Status |
| --- | --- | --- | --- | --- | --- |
| BE-008 | S2 | `warningService.confirmWarning` | Confirming an already-confirmed warning writes the buyer email again and re-stamps who and when. A double click or a retry does it. | A-2, B-14 | fixed |
| BE-009 | S2 | `app.ts` purge route | `days` of `""`, `[]` or `false` becomes 0, so every rejected photo file is deleted at once and for good. | A-6, B-5 | fixed |
| BE-010 | S2 | `eventService`, `photoService` | A `clientUuid` sent as a one-item array gives a 500, and in a batch it sinks the whole request, so the phone retries forever. | A-7, B-1 | fixed |
| BE-011 | S2 | `app.ts` CORS | The preflight does not list the four `X-` headers the photo upload sends, so uploads fail when the app and API are on different origins. | B-2 | fixed |
| BE-012 | S1 | `photoService` approve / reject | Approving an approved photo, or rejecting a rejected one, rewrites the time and the person; each extra reject also pushes the purge date out. | A-8, B-15 | fixed |
| BE-013 | S1 | `adminService.saveTemplate` | A template can be saved with a control character in a stage name; that stage then can never receive an update. | A-9 | fixed |
| BE-014 | S1 | `app.ts` error handler | A body that is too large (413) becomes a plain 400 "Invalid request", so the phone cannot tell a permanent size problem from a temporary one. | A-12, B-17 | fixed |
| BE-015 | S1 | `app.ts` board route | The clock is read twice, so rows and `today` can disagree across IST midnight. | A-13 | fixed |
| BE-016 | S1 | `orderService.text` | A PO, style or colour over 200 characters is silently cut, so two different POs collide as duplicates. | A-14 | fixed |
| BE-017 | S1 | `adminService.saveTemplate` | A rejected template shows made-up 2031 dates in its error. | A-15 | fixed |
| BE-018 | S1 | `s3Store.isMissing` | An S3 "no such bucket" (404) is read as "photo not found" and as a successful delete, with nothing logged; a wrong bucket looks like every photo vanished. | B-11 | fixed |
| BE-019 | S1 | `mediaStore` disk store | Every read error (permissions, a directory, too many files) is turned into "not found". | B-12 | fixed |
| BE-020 | S1 | `mediaFromEnv` | An `S3_ENDPOINT` with a path loses the path silently; requests go to the wrong place. | B-13 | fixed |
| BE-021 | S1 | `app.ts` public routes | `HEAD /api/health` and `HEAD /api/status` answer 401, so monitors that probe with HEAD see an outage. | B-16 | fixed |
| BE-022 | S0 | `orderService.createOrder` | The quantity-mismatch message prints equal numbers for a quantity sent as text, and "null" for none. | A-16 | fixed |
| BE-023 | S0 | `eventService`, `photoService` | A merchandiser who mistypes a stage is told "No such stage for your unit". | A-17 | fixed |
| BE-024 | S0 | `warningService`, `noteService` | "Keep it under 300 / 500 characters" is said but exactly 300 / 500 is accepted. | A-19 | fixed |
| BE-025 | S0 | `outboxService`, `warningService` | The alert list is "newest first" but rows from one refresh come back in random order; the red alert subject uses the raw lower-case stage. | A-20 | fixed |
| BE-026 | S0 | `app.ts` templates | Creating a template answers 200; every other create answers 201. | A-21 | fixed |
| BE-027 | S0 | `app.ts` create order | Creating an order does not bring the warnings up to date, against the comment on `refreshAfter`. | A-22 | fixed |
| BE-028 | S0 | `buyerExport.exportFileName` | The export file name can end with a doubled hyphen. | A-23 | fixed |
| BE-029 | S0 | `orderService.checkSizes` | Size names are not trimmed, so `" S"` and `"S"` are two sizes. | A-24 | fixed |
| BE-030 | S0 | `orderService`, `today.isStageName` | `loadTemplateSteps` is never used; stage names may contain zero-width characters or edge spaces that nobody can type again. | A-25 | fixed |
| BE-031 | S0 | `app.ts` photo routes | The photo routes answer 503 before the role check, so a supervisor learns the server's configuration. | B-22 | fixed |
| BE-032 | S0 | `app.ts` auth hook | The `Bearer` scheme is matched case-sensitively (the standard says it is not). | B-24 | fixed |
## Security, database and start-up

| ID | Sev | Where | What is wrong | Found | Status |
| --- | --- | --- | --- | --- | --- |
| BE-033 | S2 | `authService.ts` | Sign-in tells an attacker which supervisor phones exist (a locked account answers 429 in 2 ms, an unknown one 401 in 51 ms), and any supervisor can be kept locked out. | B-7 | fixed |
| BE-034 | S2 | `auth.ts` | Password and PIN checks use `scryptSync`: about 45 ms of blocked event loop per attempt, about 22 attempts a second saturate the server. | B-8 | fixed |
| BE-035 | S2 | `server.ts` | Nothing checks at start-up that `DATABASE_URL` is a role without superuser, bypass-RLS or table ownership; a pasted owner URL silently turns row-level security off. | B-10 | fixed |
| BE-036 | S2 | migration 009 policy `sup_photo_write` | A supervisor can insert an already-approved photo (skipping review) and name any storage key. | B-6 | fixed |
| BE-037 | S1 | migrations 009, 012 policies | A supervisor can also forge `note.confirmed_*`, `category_by`, and `update_event.entered_by` / `received_at`. | B-19 | fixed |
| BE-038 | S1 | migration 001 grants | The one database login role can read columns that must stay internal (`warning.maths`, rates, sizes). Nothing leaks today because queries name their columns. | B-20 | deferred |
| BE-039 | S0 | migration 015 | The backfill updates zero rows when the migration owner is not a superuser (it does not set the system role first, as 014 explains). | B-21 | fixed |
| BE-040 | S0 | migration 001 `account.email` | Email is unique case-sensitively but the app compares lower-case; login also scans the table. | B-25 | fixed |
| BE-041 | S1 | `migrate.ts`, test helper | A connection failure to `localhost` prints an empty reason (Node 20 raises an error with no message). | C-4 | fixed |
| BE-042 | S1 | `server.ts` | An empty `PORT` makes the API listen on a random port; `PORT=abc` ends in a stack trace. | C-5 | fixed |
| BE-043 | S1 | `server.ts` | `TRUST_PROXY` is honoured only as exactly `1`; any other spelling silently puts everyone in one sign-in bucket. | B-4 | fixed |
| BE-044 | S2 | `app.ts` limiter | With `trustProxy: true` a caller picks their own address by sending `X-Forwarded-For`, so the 10-failures limit is bypassed. | B-3 | fixed |
| BE-045 | S1 | `app.ts` limiter | The limiter map never forgets an address (about 130 bytes each, unbounded with IPv6). | B-18 | fixed |
| BE-046 | S2 | `app.ts` photo routes, `server.ts` pool | A database transaction (one of 10 connections) is held while the photo store is read or written, and the pool has no timeouts; ten slow reads freeze the API. | B-9, O | fixed |
| BE-047 | S0 | `eventService`, `photoService` | An update or photo may be dated any time in the past (even year 0001) and counts toward the stage. | A, B-23 | fixed |
## Tooling, release process and the quality net

| ID | Sev | Where | What is wrong | Found | Status |
| --- | --- | --- | --- | --- | --- |
| BE-048 | S3 | `scripts/check_repo.mjs` | File names with non-ASCII characters (Tamil, accents) are quoted by git, so they are neither path-checked nor scanned: a key in `தமிழ்.pem` passes the leak guard. | C-1 | fixed |
| BE-049 | S2 | `scripts/check_repo.mjs` | The secret patterns miss this project's own secrets: a database URL with a password, `TOKEN_SECRET=...`, `S3_SECRET_ACCESS_KEY=...`, a token. | C-2 | fixed |
| BE-050 | S2 | `scripts/changelog.mjs`, `release.yml` | A build can be tagged and released with the placeholder text as its public notes. | C-3 | fixed |
| BE-051 | S1 | `.env.example`, `package.json`, README | `.env.example` says "copy to .env" but nothing reads it; no script starts the real server; `tsx` (needed for it) is only a dev dependency. | C-6 | fixed |
| BE-052 | S1 | `scripts/changelog.mjs` | The secret-looking-text check rejects ordinary release prose such as "token: cancelled links stop". | C-7 | fixed |
| BE-053 | S1 | `scripts/check_repo.mjs`, `changelog.mjs` | Nothing detects one InBul id used by two commits; it has already happened twice (InBul17 and InBul18). | C-8 | fixed |
| BE-054 | S1 | `scripts/check_repo.mjs` | `md/` and `company-a-build-plan.md`, which `.gitignore` protects, are not on the forbidden list, so `git add -f` would publish them. | C-9 | fixed |
| BE-055 | S1 | `vitest.config.ts`, slow tests | Several tests use 50 to 70 percent of the 30 s timeout on an idle machine and fail on a busy one. | C-10 | fixed |
| BE-056 | S1 | `README.md` | The README says photos and notes are not built, omits two export routes, lists a finished roadmap item, and quotes old test counts. | C-11, C-12 | fixed |
| BE-057 | S0 | `scripts/check_docs.mjs` | The link check misses anchors, reference links and HTML links, and fails a valid link containing parentheses. | C-13 | fixed |
| BE-058 | S0 | `scripts/changelog.mjs` | Non-ASCII file names are written as octal escapes in the public build report. | C-14 | fixed |
| BE-059 | S0 | `scripts/changelog.mjs`, `check_repo.mjs` | They act on the repo in the current folder, not the one holding the script, and crash with a stack trace outside git. | C-15 | fixed |
| BE-060 | S0 | `tsconfig.json` | `npm run typecheck` does not cover `scripts/` or the config files, and server code is compiled with browser types. | C-16 | fixed |
| BE-061 | S0 | `packages/server/test/helpers.ts` | The test helper orders and picks migration files differently from the production runner, and the reset does not restore all settings. | C-17 | fixed |
| BE-062 | S0 | `.github/workflows` | A second push to `main` cancels the first run; a release runs no checks; the banned-terms guard is silently off on fork and Dependabot pull requests. | C-18 | fixed |
| BE-063 | S1 | `scripts/check_repo.mjs` | A `build-N` tag pushed from another branch (a release not merged here yet) has its report on that branch only, so it failed the repo check on `main` and on every other branch, including pull requests that had nothing to do with it. Found when the UI release tag reached `main` before its report did. | CI | fixed |
| BE-064 | S1 | `packages/server/test/toolingScripts.test.ts`, `.github/dependabot.yml` | The BE-060 tests read the tsconfig files through TypeScript's JavaScript API, which TypeScript 7 does not have, so the weekly dependency pull request (TypeScript 5.9 to 7.0, Vitest 2 to 5, `@types/node` 20 to 26, all in one group) broke typecheck and the real-Postgres job. Major versions were also bundled together, so one failure hid which upgrade was to blame. | CI | fixed |
## Not confirmed (could not be reproduced; kept so they are not forgotten)

- Two merchandisers moving the same ex-factory date at once, or approving and purging the same photo at once, may race (no row lock). Needs two real connections; to be tested on real Postgres.
- A full recompute of the warnings after every write may deadlock under real Postgres; the error is swallowed and warnings lag. To be removed by the optimisation work (scope the recompute).
- No graceful shutdown on SIGTERM; no handler for unhandled rejections.
- A merchandiser can stop another merchandiser; there is no merchandiser password-reset route.
- A scripted photo upload keeps its EXIF (the phone strips it); a buyer could receive location data.
- `S3_ENDPOINT` accepts any https host, including link-local addresses (operator-supplied, so not exploitable by a caller).
- Missing indexes for exact predicates (listed by the audit), harmless at pilot size.
- Several later columns stay nullable; no CHECK ties `approved_by` to `approved_at`.
- `Vary: Origin` is set only for allowed origins.
- Buyer-link token lookups are not rate-limited (the tokens are not guessable).
- Login: the lock message always says "in 15 minutes".
- `README` says photo upload is supervisor-only; merchandisers are allowed too.
- A last stage planned exactly at ex-factory is amber unless 2 working days early (buffer 0): needs a business answer.
- Test helper finds bash on Windows only in the system Git folder.
- `.gitignore` ignores any folder named `data/` and any `*.key`; it lacks `*.dump`, `*.sqlite`, `.claude/`.
- No `engines` field in `package.json`.
- Look-alike Unicode in PO, style and colour; bidi-override characters kept in notes; phone numbers starting 0 to 5 accepted.

## Counts (verified bugs, 64 rows, 3 finders' duplicates merged)

S3: 1 · S2: 14 · S1: 28 · S0: 21 (one row, BE-038, is deferred).

Status: verified: 64; fixed 63; open 0; deferred 1.
