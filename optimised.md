# Optimisations (backend)

This file records each speed-up made to the backend: what was wasteful, what changed, the measured result, the test that proves the output is the same, the risk that is left, and the lever it pulls on running cost (a smaller machine, fewer database connections, less data moved). The research behind the choices is in [optimisation-research.md](docs/optimisation-research.md).

Rules for every item here:
- The output must not change. Each change was proved by comparing the new code with the old code (kept inside the tests as the reference) or with a stored copy of the old output written before the change.
- Tests are named with the item id (`O-1:` and so on). The `Test:` lines below are for the reader; unlike `bugfixed.md` this file is not checked by a script.
- Numbers came from generated, fake data. Timings of database work were taken on PGlite (a small in-process Postgres) and are only good for comparing before with after; round-trip counts and equal-output checks are exact. The machine was busy with other work at the same time, so single timings are noisy; trust the ratios and the round trips.

## O-1 Working-day maths without walking every day

- What was wasteful: counting working days between two dates visited each day in turn and built a text date for each. The board recomputes every order on every load, so this was the main cost of the board. (The audit measured about 2,800 ms for the test set. Fixing BE-002 had already taken most of it away; this change took the rest.)
- Change: `packages/engine/src/dates.ts` rewritten inside, with the same names and the same inputs and outputs. Each calendar is turned into a lookup once, the first time it is used, and counting is arithmetic on weeks. Dates at the very ends of the range (years 0000 to 0021 and 9978 to 9999) and text that is not a date go through the old slow path on purpose, so those inputs behave exactly as before, including the error for an invalid date.
- Measured, before and after in the same run, median of 20: computing 3,000 orders (12,000 milestones, 40,000 updates) took 463 ms before and 31 ms after (15 times faster; 154 to 10 microseconds per order). Building the whole board in JavaScript (without the database) took about 645 ms before and about 49 ms after (about 13 times faster). The stall of the server while it builds the board dropped from about 0.6 s to about 0.05 s. These are CPU times, not PGlite times.
- Same output: the result for 3,000 orders hashes to the same value before and after (e32ba11074a11c92), and so does the board (0ee3a69dca5e34b7). All the BE-001 to BE-007 tests pass unchanged.
- Test: packages/engine/test/optDates.test.ts :: O-1 oracle: every exported date function equals the code it replaced
- Test: packages/engine/test/optDates.test.ts :: O-1 golden: the engine output for 300 generated orders did not change
- Test: packages/server/test/optGolden.test.ts :: OPT-A golden: board and order pages did not change
- The oracle test compares every exported date function with a verbatim copy of the old file: about 70,000 single checks and 12,000 checks on random calendars (worked Sundays, closed weekdays, empty and odd calendars, a calendar closed for 4,000 days that hits the 3650-day cap, reversed ranges, leap days, odd text, odd counts), plus every day from 2000-01-01 to 2100-12-31. The golden fixtures were written from the old code before any change.
- Risk left: a calendar is read once and then remembered by the object, so a calendar object must not be changed after it has been passed in. The server builds a new one for each request and nothing in the repository changes one (searched for, and noted in the file).
- Cost lever: processor time on every board load and every warning refresh, so the same machine carries more factories before it must be made bigger.

## O-3 Do not rewrite a warning whose figures did not change, and write the rest in groups

- What was wasteful: every refresh of the warnings rewrote the stored figures of every open warning, one statement each, even when nothing had moved. At 3,000 orders that was 261 round trips and 252 updates for a refresh that changed nothing.
- Change: `packages/server/src/warningService.ts` (`runRefresh`, `refreshWarnings`, the red alerts). The stored figures are read together with the warning and compared (with keys put in a fixed order, so the order the database stores keys in does not matter); a row is written only when the figures differ. Needed writes are collected and sent as one statement per kind (new warning, colour change, planned date moved, figures only, resolved), and the red alerts are one insert. The rule that decides who created a warning first is still the database's own unique index.
- Measured (round trips are exact): a refresh that changes nothing went from 261 round trips and 252 updates to 9 round trips and 0 updates at 3,000 orders, and from 61 trips and 52 updates to 9 and 0 at 200 orders. In milliseconds (PGlite, relative) the 3,000-order refresh went from 812 to 664 in a quiet run; most of what is left is reading the data. Do not quote the millisecond ratio; quote the round trips and the avoided writes.
- Same output: the final table is identical to the one the old per-row code produces, step by step, and the same alerts are written.
- Test: packages/server/test/refreshOpt.test.ts :: O-3: a refresh does not rewrite a warning whose figures did not change
- The group checks that a second refresh on the same input leaves the version of every row alone and sends no update; that the old code, given the same input, does rewrite every open warning (so the test can tell the two apart); that only moved rows are written, in one statement; that key order does not matter; and a seven-step run (first create, figures move, stage completes, planned date moves, ex-factory moves, calendar closes days, quiet) with confirmed and dismissed warnings in place, on two databases, one using the old function (`packages/server/test/oldRefresh.ts`, taken from the code before the change).
- Risk left: a miss in the comparison only causes one harmless extra write.
- Cost lever: database writes and their log (disk, backup size and replication traffic fall with them), and database time per request.

## O-2 Refresh only what changed, join simultaneous requests, and do a full pass now and then

- What was wasteful: every update, ex-factory change, calendar change and review opening recalculated the warnings of every order in the factory, inside the request. At 3,000 orders that was 270 round trips and about 3.8 seconds for one update.
- Change: `packages/server/src/warningService.ts` and the refresh block of `packages/server/src/app.ts`. `refreshWarnings` takes a scope: one order, a list of orders, or one unit. An update refreshes its own order; an ex-factory change, its order; a calendar change, the orders of that unit; a new order, itself; a batch, the orders it stored (nothing if every item was refused; if the batch stops on a system error the next refresh is a full one). While one refresh runs, further requests join a single waiting batch, and a caller is released only after a run that began after its call. A full refresh still runs: on the first refresh after the factory date changes, when the last full one is older than 5 minutes (setting `warningFullRefreshMs`, environment variable `WARNING_FULL_REFRESH_MS`; 0 means always full), on the first refresh of a new process, after any failed refresh, and when the settings have been edited behind its back. Opening the review queue is full when due; otherwise it re-checks the orders that carry an open warning. The state lives in one object per app (`WarningRefresher`), with no shared module state.
- Measured (round trips exact; 3,000 orders with 252 open warnings; milliseconds are PGlite and relative): saving one update went from 273 round trips and 3,810 ms to 20 round trips and 9 ms (18 ms in a noisy run); an ex-factory change from a full refresh to 29 trips and 14 ms; a calendar change from 270 trips and 3,768 ms to 19 trips and about 690 ms (the synthetic data puts about 80 percent of orders in one unit, so the work is real); opening the review queue when clean from 273 trips and 3,945 ms to 22 trips and 201 ms (a full refresh is 736 ms). At 200 orders an update went from 73 trips and 298 ms to 20 trips and 10 ms. The audit's "before" figures are used; the tree has since gained the O-1 speed-up, so the same-tree old code is faster than the audit (812 ms for a full refresh at 3,000 orders).
- Same output: after every write, the new logic and a full refresh after every write end in the same tables.
- Test: packages/server/test/refreshEquivalence.test.ts :: scoped refresh == full refresh after every write
- Test: packages/server/test/refreshOpt.test.ts :: O-2: a scoped refresh touches only its scope
- Test: packages/server/test/refreshOpt.test.ts :: O-2: when the refresher runs what
- Test: packages/server/test/refreshOpt.test.ts :: O-2: what each route asks for
- The equivalence test runs 30 seeded sequences of 12 steps through the real routes on two identical databases (events with retries, batches, ex-factory moves, calendar changes, new orders, clock steps across midnight in India, review reads, confirm, dismiss) and, after every step, compares the whole warning table, the alerts, and what each buyer can read. As a check on the test itself, emptying the unit scope makes 18 of 30 sequences fail, and removing the day roll-over rule does too. A seed can be replayed with `REFRESH_SEED=<n>`.
- Risk left: another process, or a hand edit of orders, updates or milestones for an order with no open warning, is seen at the next full refresh (at most 5 minutes, the next new day, or any write in that other process). Edits to an order that has a warning are seen when the review queue is next opened. Two server copies each keep their own flags. A very large unit (a calendar change) still costs about a full refresh. Opening the review queue re-checks the orders with open warnings instead of skipping when clean: five older tests change rows by SQL between two reads of the queue and expect the second read to show the corrected rows, and the re-check costs about a third of a full refresh.
- Cost lever: database round trips and processor time per write, which sets how many connections and how big a machine are needed as the number of orders grows; also fewer chances for two refreshes to wait on each other.

## O-9 Build the buyer view in one pass

- What was wasteful: for each order, the code searched the whole list of milestones, photos and warnings again (a search inside a search), so the work grew with the square of the number of orders.
- Change: `packages/server/src/buyerService.ts` `readBuyerView` groups milestones, photos and warnings by order once, with a map. Groups keep the order they came in, and an order with none gets an empty list.
- Measured (assembly in JavaScript only, no database, median): 30 orders 0.060 to 0.023 ms (2.6 times); 300 orders 1.64 to 0.11 ms (15 times); 3,000 orders with 12,000 milestones 176 to 0.82 ms (216 times).
- Same output: the old assembly (and its SQL) is kept in the test and compared with `toEqual` and with the text of the JSON (key order and list order), for all 8 generated buyers: 300 orders, 900 photos (approved, pending, rejected and purged), 250 warnings (confirmed, dismissed, resolved). The test also checks that there are enough photos, warnings and milestones for the comparison to mean something.
- Test: packages/server/test/optServices.test.ts :: O-9: the buyer view equals the old nested-filter assembly for all 8 buyers
- The older buyer and export tests pass unchanged.
- Risk left: none found.
- Cost lever: processor time on every buyer page load, which stays flat as a buyer's orders grow.

## O-10 Leave out a sort the engine does not need, and the sizes it does not use

- What was wasteful: the query for update events sorted all of them, and the board load fetched the `sizes` of every order although only the order page shows them.
- Change: `packages/server/src/engineData.ts`: the events query has no ORDER BY; `sizes` is read only when one order is asked for (the all-orders load gets `null::jsonb as sizes`, so `OrderRow.sizes` is `{}` there; the type has a comment). The sorts on orders, milestones and calendar days were kept: the board and the warning refresh depend on order order (alert row order, BE-025) and milestone order keeps ties in the stage sort stable, and they cost little. The multi-order loader in `warningService.ts` was made the same way.
- Measured (PGlite, relative): the events query on 40,000 rows, `EXPLAIN ANALYZE` as the app role, 99.2 ms to 42.4 ms (2.3 times). For `sizes` there is no measurable database time (9.46 to 9.35 ms); the saving is about 180 KB less JSON sent and parsed on each full load, which PGlite cannot show because it has no network.
- Same output, and why event order cannot matter: the engine only adds whole numbers (exact in any order), builds sets and maps of dates and sorts them, and keeps the first update per client id, which is the one order-dependent step and cannot happen because `client_uuid` is unique.
- Test: packages/engine/test/optEventOrder.test.ts :: O-10: event order does not change the engine output
- Test: packages/server/test/optServices.test.ts :: O-10: the board and all 300 order pages equal the stored original when the events arrive shuffled
- Test: packages/server/test/optServices.test.ts :: O-10: the load asks the database for no ORDER BY on events
- Test: packages/server/test/optServices.test.ts :: O-10: two updates can never share a client_uuid
- The engine test shuffles the events of 300 generated orders five ways, plus reversed and sorted, and compares the result, the kept updates and the days that feed the pace. The server tests compare the board and all 300 order pages with a copy stored before the change, with the rows shuffled (two seeds) and reversed, and check the text of the query. `O-10: the order page still shows the sizes of its order` keeps the order page whole.
- Risk left: the engine would depend on event order if quantities were ever fractional (the column holds whole numbers) or if the unique constraint on `client_uuid` were dropped. Any new user of the sizes in the all-orders load must ask for one order.
- Cost lever: database sort time and data transferred per full load.

## O-14 Four read indexes

- What was wasteful: four reads scanned a whole table to find a few rows: the buyer's milestones, the buyer's approved photos, an order's history of date changes, and an order's notes.
- Change: new migration `packages/server/db/migrations/017_read_indexes.sql`: `milestone_buyer`, `photo_buyer_approved` (partial, with the same condition as the query), `date_change_entity`, and `note_order_newest` on (order, newest first, id), which matches the query's sort and so removes the sort. `create index if not exists`; needs only table ownership, no superuser, row-level security untouched. Only the last-file pin in `migrate.test.ts` changed.
- Measured (PGlite, relative; 3,000 orders, 12,000 milestones, 5,000 photos, 2,000 notes, 1,500 date changes; as the app role with row-level security on; median of 20): buyer milestones 1.306 to 0.276 ms (4.7 times, full scan became an index scan); buyer photos 0.597 to 0.029 ms (21 times); order-page date-change history 0.527 to 0.054 ms (10 times); order-page notes 0.268 to 0.039 ms (7 times). The indexes take 104 kB, 32 kB, 80 kB and 136 kB.
- Not added, with the measurement: review queues for pending photos and notes (1.0 times at the audit's mix; 1.80 to 1.20 ms at a realistic queue, under one millisecond, so no index; revisit when the photo table is far larger); a milestone index by unit for the supervisor's stages (a supervisor reads a fifth of the table and the planner keeps the scan); an index on updates to avoid the sort (the planner ignores it, and O-10 removed the sort anyway). The indexes that exist already suit their routes.
- Same output: indexes change speed only. `migrate.test.ts` applies all migrations from empty, compares the schema and indexes with the test helper's, and applies them as a non-superuser owner.
- Test: packages/server/test/migrate.test.ts :: build the same schema as the test helper does, from empty
- Risk left: each index slows writes a little and takes about 0.35 MB at this size; they were built without `CONCURRENTLY`, which a migration inside a transaction cannot do (a lock is held while they build, which is short at this size). The real-Postgres owner run is skipped without `TEST_DATABASE_URL`.
- Cost lever: database read time and disk reads on the buyer page and the order page, which keep their speed as tables grow.

## O-17 One shared date formatter for "today in India"

- What was wasteful: `istDate` built a new `Intl.DateTimeFormat` on every call, which is slow, and it is called for every request that needs today's date.
- Change: `packages/server/src/today.ts` creates one formatter (`en-CA`, time zone Asia/Kolkata) when the module loads and reuses it.
- Measured (CPU, 20,000 calls): 1,529 ms to 22 ms (68 times; 76 to 1.1 microseconds per call).
- Same output: 20,000 random instants between 2000 and 2100 give the same text as a fresh formatter; the turn-over at 18:30 UTC (midnight in India) is checked at 18:29:59 and 18:30:00; the older `istDate` cases in `core.test.ts` pass unchanged.
- Test: packages/server/test/optServices.test.ts :: O-17: istDate with one shared formatter
- Risk left: none (the formatter holds no state between calls).
- Cost lever: a small amount of processor time on every request.

## How to measure again

The benchmark scripts used for the numbers above were run from outside the repository and are not kept in it, so the numbers cannot be reproduced from a checkout with one command. What is in the repository, and is enough to re-check the claims:
- Same output: `packages/engine/test/optDates.test.ts`, `packages/engine/test/optEventOrder.test.ts`, `packages/server/test/optGolden.test.ts`, `packages/server/test/optServices.test.ts`, `packages/server/test/refreshOpt.test.ts`, `packages/server/test/refreshEquivalence.test.ts`. Run them with `npx vitest run packages/engine packages/server`.
- Generators and stored copies of the old output: `packages/engine/test/optData.ts`, `packages/engine/test/fixtures/` and `packages/server/test/optData.ts`, `packages/server/test/fixtures/`; the old code used as the reference is `packages/engine/test/datesOracle.ts` and `packages/server/test/oldRefresh.ts`. Rewrite a stored copy only with `OPT_WRITE_GOLDEN=1`, and only after a change that is meant to change output.
- Slowest tests: set `SLOWEST_TESTS=1` (or `CI`) to print the 10 slowest tests of a run.
- To measure time again, time the same calls before and after a change on the same machine, with generated data, and compare ratios (median of 20 runs); for database reads use `EXPLAIN (ANALYZE, BUFFERS)` as the app role, and repeat on a real Postgres before trusting millisecond values.

## Lane C: web traffic, connections and logging

Numbers in this lane come from generated, fake data on a laptop. Round trips, bytes and the connection model are exact; database milliseconds are PGlite and only good for comparing. A round trip is counted the way the audit counts it: a transaction costs 3 (begin, set the caller, commit) plus its queries. The benchmark scripts were run from outside the repository, so only the tests are kept here. None of these changes alter what any route answers, except where a section says so.

### O-4 Compress big answers, and let a client skip an unchanged one

- What was wasteful: the board for 3,000 orders is about 2 MB of JSON, sent in full on every poll, although it compresses about 19 times and often has not changed.
- Change: `packages/server/src/httpCache.ts` and `app.ts`, one `onSend` hook. JSON answers of 1,024 bytes or more are gzipped (level 4, on the thread pool, not the event loop) when the client accepts gzip; `Vary: Accept-Encoding` is added to any CORS `Vary`. Photos and CSV are never touched. The four polled routes (`/api/board`, `/api/review`, `/api/my/stages`, `/api/buyer/orders`) carry a weak `ETag` that is a hash of the person and the body just built; a matching `If-None-Match` gets a 304 with no body. Because the tag is a hash of the finished body, it changes whenever the answer changes, whatever changed it. CORS now allows `If-None-Match` and exposes `ETag`. `compress: false` switches gzip off.
- Measured: the board for 3,000 orders went from 1,998,264 bytes to 106,755 bytes gzipped (18.7 times); gzip took 17.3 ms of processor time at that size. An unchanged poll answers 304 with 0 body bytes. The 304 does not save server work (the body is still built to be hashed), so no time saving is claimed. The review queue in this data set is tiny (1,060 to 614 bytes); the audit's larger review case was not measured again.
- Same output: unzipped, the compressed body equals the plain body byte for byte.
- Test: packages/server/test/optHttpCache.test.ts :: O-4: a big JSON body is gzipped for a client that accepts gzip, and unzipped it is the plain body byte for byte
- Test: packages/server/test/optHttpCache.test.ts :: O-4: the four polled routes carry an ETag, answer 304 with no body when it matches, and still say no-store
- Test: packages/server/test/optHttpCache.test.ts :: O-4: a change made behind the app (SQL, another process) moves the tag too
- Test: packages/server/test/optHttpCache.test.ts :: O-4: no 304 across people
- The tests also check: no gzip without the header, with q=0 or for small bodies; photos and CSV never compressed; a new tag after every kind of write (event, batch, ex-factory, calendar, new order, confirm, dismiss, undo, photo approve and reject); a revoked buyer link is a 401, never a 304.
- Risk left: `Cache-Control: no-store` was kept (see Decisions), so a browser does not revalidate by itself; the 304 only helps when the web app keeps its own last tag and body and sends `If-None-Match`. The tag is weak and hashes the body before compression, so one tag serves both forms. SHA-1 here only detects change; it is not for security.
- Cost lever: data sent out of the server (about 19 times less for the big answers), and the time a phone on a slow link waits.

### O-5 Remember the sign-in check for a few seconds

- What was wasteful: every request opened a transaction to look up the account (token version, stopped or not, unit) before doing its own work, 4 of the round trips of a simple call.
- Change: `packages/server/src/authCache.ts` and `app.ts`. The account details are kept for 5 seconds per account (`authCacheMs` in the app options; 0 turns it off), at most 2,000 accounts (oldest dropped); simultaneous first requests share one lookup; "not found" and failures are never kept. Sign-out everywhere, stop or allow, PIN reset and creating a supervisor or merchandiser clear the entry after their transaction, so those take effect on the very next request. A lookup that began before a clear is not stored and is not shared with one that began after.
- Measured (round trips per request, steady state): `/api/me` 4 to 0; `/api/reasons` 8 to 4; `/api/board` 13 to 9; `/api/my/stages` 8 to 4. Honest limit: a client that polls only once a minute misses the 5-second window every time and saves nothing; the gain is for bursts (a screen load makes 3 to 6 calls, a photo sync many) and for polling faster than every 5 seconds.
- Same output: the answers are the same; only the account lookup is skipped. Changes made through this server take effect at once (tests: 20 requests make 1 lookup; 15 simultaneous first requests make 1; `authCacheMs: 0` makes one per request).
- Test: packages/server/test/optAuthCache.test.ts :: O-5: the account is read once for many requests, not once per request
- Test: packages/server/test/optAuthCache.test.ts :: O-5: stopping an account: the next request is 401, though the account was remembered a moment ago
- Test: packages/server/test/optAuthCache.test.ts :: O-5: sign out everywhere, in capitals too
- Test: packages/server/test/optAuthCache.test.ts :: O-5: a PIN reset signs the person out at once
- Test: packages/server/test/optAuthCache.test.ts :: O-5: and without invalidate() the window ends by itself after authCacheMs
- Risk left, the staleness window: for up to `authCacheMs` (5 seconds) after a sign-out, stop, PIN reset or unit move done by another server process or directly in SQL, the old answer can still be used. The process that handles the admin action is exact. Moving a supervisor to another unit has no route (it is done in SQL), so it is also subject to the window unless the server is restarted. With two server processes and a need for exactness, set `authCacheMs: 0` (an app option; there is no environment variable for it). The buyer link check is not cached (low volume).
- Cost lever: database round trips and connection time per request, which sets how many connections and how big a database machine are needed.

### O-7 Do not hold a database connection while the photo store works

- What was wasteful: the photo routes called the photo store (disk or S3) from inside the database transaction, so a slow store held one of the connections for the whole wait. This is also the bug BE-046 in `bugfixed.md`.
- Change: `packages/server/src/photoService.ts` and `app.ts`. A read finds the file name in a short transaction, gives the connection back, then reads the file. An upload does a short check (which also answers a repeat without touching the store), stores the file under a fresh random name with nothing open, then inserts the row in a short transaction; on a lost race or failure the stored file is taken back. The purge works in batches of 100 with nothing open during the deletes. The price is more round trips for an upload (5 to 8), in exchange for a connection held only for database work.
- Measured (fake database, pool of 10, 0 ms query time so only the store call holds a connection, 30 simultaneous uploads of 200 KB; the audit's old numbers reproduce): at 150 ms store delay the connection held per upload went from 155 ms to under 1 ms; an unrelated request during the burst waited 421 ms before and 0 ms after; the 30 uploads finished in 465 ms before and 174 ms after. At 1,000 ms store delay: held 1,006 ms to 0; unrelated wait 2,977 ms to 0; finished in 3,031 ms before and 1,012 ms after. With a store with no delay the burst takes longer (42 ms to 83 ms) because of the extra trips.
- Same output: the answers for success and for each failure are the same; the tests assert it with fault injection.
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: upload, staff read, supervisor read, buyer read and clean-up: zero open transactions at every store call
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: with the store stuck, the API still answers
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: five identical uploads at once make one row and leave one file
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: clean-up deletes files with no transaction open
- Risk left: after a crash between the store write and the insert, an object can stay in the store with no row; nothing sweeps those (see Decisions). "No row without a file" always holds. The purge now throws the first failed delete after marking the others (before, everything rolled back and gave the same 500).
- Cost lever: database connections, so a smaller pool and a smaller database machine are enough, and a slow photo store no longer freezes the rest of the app.

### O-11 One short log line per request

- What was wasteful: the default logger wrote two long lines per request (366 bytes), including the address as written, and health probes every few seconds.
- Change: `packages/server/src/app.ts` and `startup.ts`. The default request lines are off, replaced by one line with the level, time, request id, method, route pattern, status and milliseconds. The route is the pattern (`/api/orders/:id`) and `unmatched` for unknown addresses, so no id, query text or buyer link token can reach the log. Successful health and status probes are not logged. `LOG_LEVEL` sets the level (default info). Errors still log with the same request id.
- Measured: 364 bytes in 2 lines per request to 103 bytes in 1 line (3.5 times; a test measures both).
- Same output: no answer changes; only what is written to the log.
- Test: packages/server/test/optLogging.test.ts :: O-11: a request logs exactly one line with method, route pattern, status and milliseconds
- Test: packages/server/test/optLogging.test.ts :: O-11: the buyer link never reaches a log line
- Test: packages/server/test/optLogging.test.ts :: O-11: a 500 still logs its error with the request id
- Risk left: a 4xx caused by a bad request is logged at info like any other; moving 5xx to warn is one word.
- Cost lever: log volume (disk and anything that stores or ships logs).

### O-12 The sign-in limiter map is bounded

- What was wasteful: the map that counts failed sign-ins per address never forgot an address. This is also BE-045 in `bugfixed.md`.
- Change: `packages/server/src/loginLimiter.ts`: at most 10,000 entries, expired ones swept every 60 seconds, an entry removed when its last failure is given back.
- Measured: memory held for 1,000,000 different callers went from 189 MB to 1.85 MB.
- Same output: the 10-tries budget and the lock behave as before.
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-045: a hard cap: a million addresses leave at most
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-045: an entry whose window has ended is removed by the sweep, one still running is not
- Risk left: at 10,000 live entries an attacker with 10,000 different /64 address ranges could push a real lock out of the map; the effect is only that the victim's address gets a fresh budget.
- Cost lever: memory over time, so the process does not grow until it is restarted.

### O-13 A smaller pool with time limits, and a clean shutdown

- What was wasteful: the pool held up to 10 connections, waited for a free one for ever, and had no limit on a statement or on a request that stalls. A stop signal cut off work in progress.
- Change: `packages/server/src/startup.ts`, `pgDb.ts`, `s3Store.ts`, `server.ts`. Pool of 5 connections (`DB_POOL_MAX`), 5 s wait before a `503 busy`, 60 s idle, 30 s per statement (`DB_STATEMENT_TIMEOUT_MS`; 0 = off), 15 s idle inside a transaction. S3 calls give up after 5 s to connect and 15 s per request (3 attempts as before); Fastify request timeout 120 s. On SIGTERM or SIGINT the server stops taking requests, lets the ones in progress finish, closes the pool and exits 0; a failure or a wait over 10 s exits 1; a second signal does nothing; an unhandled rejection is logged and the server keeps running.
- Measured: not a speed change; it removes the unbounded waits. A pool request with no free connection now answers in 5 s instead of waiting for ever (checked with a fake driver; nothing was run on a real Postgres).
- Same output: no route answer changes, except the new `503 busy` when no connection is free.
- Test: packages/server/test/optStartup.test.ts :: O-13: the app is closed first, then the pool, then the process exits 0
- Test: packages/server/test/optStartup.test.ts :: O-13: the pool is not closed until the requests in flight have finished
- Test: packages/server/test/optStartup.test.ts :: O-13: against a real listening server: a request in flight is answered, new connections are refused, then the pool is ended
- Test: packages/server/test/optStartup.test.ts :: O-13: connection 5 s and request 15 s per attempt
- Risk left: the wiring in `server.ts` itself is not run by any test (the functions in `startup.ts` are, including with a real listening server). The values 5, 5 s and 30 s are picks that suit one or two processors.
- Cost lever: a smaller pool means fewer database connections to pay for and fewer processes on the database side, and a stuck call can no longer hold a connection for ever.

### Decisions for the owner

1. Cache-Control against ETag. Existing tests pin `no-store` on the board, my stages and the buyer view (and the review queue matches), so `no-store` was kept on all four. A browser does not revalidate a `no-store` body by itself, so the ETag and 304 only help when the web app keeps its own last tag and body and sends `If-None-Match` itself (CORS is ready for that); gzip works for everyone with no client change. The alternative is `Cache-Control: private, no-cache` on those four routes: the browser then revalidates on its own and keeps the body on disk. That is a one-line change per route plus three test lines, and a security and product choice. Decide, and tell the web side to send `If-None-Match` if it stays `no-store`.
2. Pool defaults. 5 connections (was 10), a 5 s wait before `503 busy`, 30 s per statement and 15 s idle in a transaction are defensible for one or two processors. Change `DB_POOL_MAX` and `DB_STATEMENT_TIMEOUT_MS` if the host differs.
3. `TRUST_PROXY` as a hop count needs the API port closed to the outside: the server believes the count without checking the immediate peer. Prefer the address-list form when the proxy address is known.
4. Orphan photo objects. Objects left in the store with no database row after a crash are not swept. A periodic sweep ("objects older than a day with no photo row") is not written.
5. `authCacheMs` 5 seconds is on by default and can lag by up to 5 seconds for changes made by another process or directly in SQL (see O-5).

### Considered and not done in this lane

- Merging `begin` and the caller setting into one round trip in every transaction: one trip fewer each time, but it needs built SQL with checked values and a real Postgres to test.
- Caching the buyer link check: same idea as O-5, low volume.
- Running a batch of updates in one transaction (O-16): behaviour-sensitive.
- A photo ETag or `private, no-cache` on photos (O-15): a policy decision first.
