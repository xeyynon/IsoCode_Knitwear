# Fixed bugs (backend)

This file is the memory of every bug in `bug.md` that has been fixed. Each entry says what was wrong, what changed, which test proves it, what the test showed before the fix, and which earlier work the change could have touched.

Rules that keep a fixed bug from coming back:

1. Every fix has a regression test, written first and named with its BE id (the test title starts with `BE-nnn:`). Where a test could not be seen failing first, the entry says so.
2. `node scripts/check_bugs.mjs` (part of `npm run check` and of CI) fails when a listed test does not exist, when a bug marked fixed in `bug.md` has no entry here, or when an entry names an id that is not in `bug.md`. Do not weaken it: fix the name.
3. Before changing code near an entry, read that entry and keep its test passing. If a change has to alter an old test, say why in the commit and in the entry.
4. The whole suite runs on every push.

Format of an entry: a heading `## BE-nnn short title`, then Root cause, Fix, one or more `Test:` lines (`path from the repository root :: start of the test title`), Before the fix, Guard.

The deferred bug (BE-038) has an entry with no test line.

## BE-001 A stage exactly on pace was projected one day late
- Root cause: the daily average is a decimal that cannot be held exactly, so 4520 divided by it came to 15.000000000000002 and rounding up gave 16 days.
- Fix: `packages/engine/src/index.ts`, `projectOrder`: when the pace is the window average the day count is an exact whole-number round-up of remaining x days / total (`daysAtAverage`); for a planned pace `daysAtRate` allows 1e-9, the same slack the file already used for the shortfall. Both are exported.
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-001: 301/301/302 finished days with 4520 left
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-001: the day count equals the exact integer ceil(R*n/S)
- Before the fix: `expected '2026-11-20' to be '2026-11-19'`, and in the 3000-case check `n=3 S=1646 R=14814: engine says 28 working days, exact ceil is 27`.
- Guard: BUG-055, BUG-056, BUG-057, DEC-010 and DEC-021 (older engine and tna tests, all pass); the shortfall code is untouched; 22,000 exact-pace combinations were tried and none gave a false "behind".

## BE-002 One far-future date could stop the whole server
- Root cause: working days were counted by visiting every day, and nothing limited how far away a date could be; `9999-12-31` took about 22 seconds.
- Fix: `packages/engine/src/dates.ts`: `workingDaysBetween` is now arithmetic (weeks, minus Sundays, plus the calendar exceptions in range) and `nthWorkingDayAfter` searches over that count, keeping the old 3650-day cap. New `MIN_DATE` 2000-01-01, `MAX_DATE` 2100-12-31, `isDateInWindow`. `packages/server/src/today.ts` `isIsoDate` refuses dates outside that window, so every place that takes a date is bounded.
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-002: a far-future milestone (9999-12-31) projects in under 50 ms
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-002: equals the day-by-day loop for every (from, to) pair
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-002: 9999-12-31 is refused, and so is 2101-01-01
- Test: packages/server/test/bugfixEngineDataApi.test.ts :: BE-002: an ex-factory date of 9999-12-31 is refused (400)
- Before the fix: `expected 22554.4353 to be less than 50`, and `isIsoDate('9999-12-31')` was true. The API tests were written with the fix, not seen failing; the matching unit tests were.
- Guard: the old day-by-day loops are kept inside the tests as the reference (about 4000 pairs per calendar, 400 random long ranges, 600 cap cases); the 3650-day cap is unchanged; DEC-010 and DEC-021 engine tests pass. A row already stored outside the window no longer stalls anything.

## BE-003 Years 0000 to 0099 were read as 19xx
- Root cause: `Date.UTC` maps the years 0 to 99 to 1900 to 1999, so a typo such as `0026` gave garbage dates.
- Fix: `packages/engine/src/dates.ts` `toUtc` works out those years through the 400-year repeat of the calendar (exact); `isIsoDate` in `today.ts` also refuses them, because the allowed window starts in 2000.
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-003: addDays works in year 0050 and 0099 like any other year
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-003: year 0026 is refused, as is the whole of 0000-0099
- Test: packages/server/test/bugfixEngineDataApi.test.ts :: BE-003: an ex-factory date in year 0026 is refused
- Before the fix: `expected '1950-01-02' to be '0050-01-02'`, `expected 0 to be less than 0`, and `isIsoDate('0026-11-20')` was true.
- Guard: the same day-by-day reference tests as BE-002 pass; the later speed-up O-1 (see `optimised.md`) keeps the old slow path for these years on purpose so they stay exact.

## BE-004 The low-confidence flag looked at different days from the pace
- Root cause: `confidence.ts` took the newest days of all updates (today and closed days included), while the engine uses finished working days (today only when there are too few).
- Fix: one rule in `packages/engine/src/index.ts`: `pickRateDates`, with `rateDates` and `cleanEvents`; `packages/server/src/confidence.ts` `lowConfidenceStages` flags a stage only when an on-behalf entry sits on one of those days; `calendarOfStages` gives each stage its unit's closed days; `orderDetailService.ts` and `boardService.ts` pass the real settings and calendars.
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-004: an entry is flagged exactly when changing its quantity would change the stage rate
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-004: the oldest day of the rate window entered on behalf is flagged
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-004: one rule for the days that feed the rate
- Test: packages/server/test/bugfixBoardConfidence.test.ts :: BE-004: board and order page agree on low confidence
- Before the fix: `expected [] to deeply equal [ 's' ]` and `case 0: 2026-10-23 changes the rate=true but flagged=false`.
- Guard: DEC-021 (pace from finished days) now lives in the one function `pickRateDates`; its engine tests pass. Three tests in `onBehalf.test.ts` pinned the old rule and were edited (entries dated yesterday instead of today; a Sunday date moved). See Open questions.

## BE-005 Settings were not range-checked
- Root cause: `loadSettings` read any value with `Number(...)`, so null, an empty text or a list became 0, and `window_days = 0` gave a NaN pace and a green stage far behind.
- Fix: the engine exports `isValidSetting` and `normalizeSettings` (whole-number ranges for the day settings, 0 < red-below <= 1); `packages/server/src/engineData.ts` `loadSettings` takes only a JSON number or a numeric text, checks each key alone, keeps the default for a bad one and ignores unknown names; `projectOrder` also normalises what it is given.
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-005: window_days = 0 keeps the default of 5
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-005: a JSON null is ignored, not read as 0
- Test: packages/server/test/bugfixEngineDataApi.test.ts :: BE-005: window_days = 0 and a JSON null in the table leave the red order red
- Before the fix: `expected +0 to be 5`, `expected null to be 100` (the pace was NaN and the status green).
- Guard: with the seeded settings (all valid) behaviour is identical and the whole older suite passes.

## BE-006 The order page's closed-day list stopped after 400 days
- Root cause: `closedDaysIn` had a loop bound of 400 days.
- Fix: `packages/server/src/orderDetailService.ts` `closedDaysIn` clamps the span to the date window and returns every closed day in it (Sundays a week at a time, minus Sundays marked as worked, plus closed days from the calendar), sorted, with the same reasons.
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-006: three years with no entries return every Sunday, to the last one
- Test: packages/server/test/bugfixEngineDataApi.test.ts :: BE-006: an order shipping years out lists its Sundays to the last one
- Before the fix: the list ended 2027-01-31 after 57 Sundays (`expected 57 to be 5270` for the long span).
- Guard: reasons ('Sunday', 'Closed', or the note) are unchanged; 100 years are listed in under 50 ms. The response's `calendar.from/to` still carry the unclamped span (see Open questions).

## BE-007 The words "90%" and "2 working days" were fixed in the reason text
- Root cause: the reason strings had the numbers typed in, although the thresholds are settings.
- Fix: `packages/engine/src/index.ts`: the red, amber and buffer reasons are built from the settings (`making less than N% of needed`, `making N%-100% of needed`, `buffer ... under B working day(s)`; "day" for 1). Percentages print without noise (0.925 gives 92.5).
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-007: with the stock settings the words are the ones the screens and the README already show
- Test: packages/engine/test/bugfix_BE.test.ts :: BE-007: a different redBelow is quoted in both the red and the amber reason
- Before the fix: `expected [ ...(2) ] to include 'making less than 50% of needed'`; the buffer reasons still said 2.
- Guard: with the stock settings the strings are byte for byte the old ones, so the README and the web app are unaffected (no code matches on these strings).

## BE-008 Confirming a confirmed warning wrote the buyer email again
- Root cause: the UPDATE in `confirmWarning` matched any open warning, even one already confirmed, so it re-stamped who and when and wrote a second email.
- Fix: `packages/server/src/warningService.ts` `confirmWarning`: the UPDATE also requires "not yet confirmed, or new different wording given". If it matches nothing, a second query tells apart: same words or no words (quiet no-op), colour or wording changed since the person looked (409 `changed`), not open (409 `not_open`), unknown (404). Different wording is a knowing change, so it is sent once more.
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-008: confirming a warning twice writes one buyer email and keeps who and when
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-008: confirming again with the same words changes nothing and tells nobody
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-008: a re-confirm still refuses when the colour or wording the person saw has changed
- Before the fix: `expected [ {...}, {...} ] to have a length of 1 but got 2` (and 3 against 2 for the reworded case).
- Guard: nothing reaches a buyer until a merchandiser confirms (review, outbox, undoDismiss, exactlyOnce and buyer tests pass); the 409 rule and the dismiss/undo rules are unchanged. The "two in flight" test only proves the one-after-another case on PGlite.

## BE-009 A blank `days` on the purge route deleted every rejected photo file
- Root cause: `Number('')`, `Number([])` and `Number(false)` are 0, meaning "older than 0 days".
- Fix: `packages/server/src/app.ts` purge route accepts only a number or a text of 1 to 5 digits (else NaN, which `purgeRejectedPhotos` already refuses with 400); nothing or null still means 7.
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-009: days as %s is refused and the file stays
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-009: a number, a digit string, nothing and null still work as before
- Before the fix: `expected 200 to be 400` for the empty text, the empty list and false.
- Guard: only rejected photos older than `days` are removed; the purge tests in `photo.test.ts` pass.

## BE-010 A client id sent as a list gave a 500 and sank the whole batch
- Root cause: the id pattern test turned a one-item list into text and passed it, then `toLowerCase()` failed (500; in a batch the phone retried forever). An `orderId` list passed silently.
- Fix: `packages/server/src/eventService.ts` checks `typeof === 'string'` before the pattern for clientUuid, orderId and photoId; `packages/server/src/photoService.ts` does the same for clientUuid, orderId and stage.
- Test: packages/server/test/bugfixEvents.test.ts :: BE-010: %s is a plain 400 on a single update
- Test: packages/server/test/bugfixEvents.test.ts :: BE-010: in a batch the bad item is rejected alone and the good one is kept
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-010: savePhoto answers a clear refusal for a clientUuid or orderId that is not text
- Before the fix: `expected 500 to be 400`, `expected 200 to be 400` (an order id list was stored), and the batch `expected 500 to be 200`.
- Guard: sending exactly once (advisory lock and savepoint) is untouched; `bugfixEvents` has "a retry of a good update is still a duplicate, once"; exactlyOnce, fuzz and onBehalf tests pass.

## BE-011 The CORS preflight did not allow the photo upload headers
- Root cause: the preflight listed only Authorization and Content-Type, but the upload also sends four `X-` headers.
- Fix: `packages/server/src/app.ts`: Access-Control-Allow-Headers adds X-Client-Uuid, X-Order-Id, X-Stage and X-Date.
- Test: packages/server/test/bugfixApp.test.ts :: BE-011: OPTIONS for a photo upload allows the four X- headers
- Test: packages/server/test/bugfixApp.test.ts :: BE-011: an origin that is not listed still gets no CORS headers at all
- Before the fix: `expected [ 'authorization', 'content-type' ] to include 'x-client-uuid'`.
- Guard: the exact-match list of allowed origins is unchanged (the CORS tests in `api.test.ts` pass).

## BE-012 Approving or rejecting twice rewrote the time and the person
- Root cause: approve ran an unconditional UPDATE and reject set `rejected_at` every time, which also pushed the purge date out.
- Fix: `packages/server/src/photoService.ts`: approve is one UPDATE guarded by "not purged and (not approved or rejected)" and only the call that changed the row writes the buyer email; reject is `... where rejected_at is null`. A repeat is a quiet no-op; an unknown or purged photo is still 404.
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-012: approving an approved photo keeps the first approver and time
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-012: rejecting a rejected photo keeps the first time
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-012: approving a rejected photo still brings it back
- Before the fix: the approver was replaced (`expected '...e2' to be '...ee'`) and the reject time moved.
- Guard: approve, reject, withdraw and purge in `photo.test.ts` pass; a purged photo still cannot be approved. Not run on a real Postgres (see Open questions).

## BE-013 A template could be saved with a control character in a stage name
- Root cause: `saveTemplate` only trimmed the name, while updates and photos apply `isStageName`, so that stage could never receive an update.
- Fix: `packages/server/src/adminService.ts` `saveTemplate` runs `isStageName` on each cleaned name and answers 400 "Stage N's name has a character that is not allowed". It uses the same function as BE-030, so that tightening applies here too.
- Test: packages/server/test/bugfixOrders.test.ts :: BE-013: %s in a stage name is refused and nothing is saved
- Test: packages/server/test/bugfixOrders.test.ts :: BE-013: ordinary and Tamil stage names are still saved
- Before the fix: `expected 200 to be 400`.
- Guard: DEC-023 (a saved template can never be one the order setup refuses) is untouched; the admin and templateCalendar tests pass.

## BE-014 A body that was too large became a plain 400
- Root cause: the error handler turned every framework 4xx into 400 "Invalid request", so the phone could not tell a permanent size problem from a temporary one.
- Fix: `packages/server/src/errors.ts` allows 413; `packages/server/src/app.ts` handler answers 413 `photo_too_large` ("That photo is too large") for photo bodies and 413 `too_large` for anything else; `photoService.ts` uses the same code for the tiny-file check.
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-014: 4 MB answers 413 photo_too_large
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-014: any other oversized body is a 413 too_large
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-014: a 3 MB photo is still accepted
- Before the fix: `expected 400 to be 413`, body code `bad_request`.
- Guard: error messages are fixed text with no internals; the phone treats any 4xx except 429 on an upload as permanent. `photo.test.ts` allows 400 or 413 for a file over 3 MB.

## BE-015 The board route read the clock twice
- Root cause: the handler read the clock once for the rows and once for `today`, which can disagree across midnight in India.
- Fix: `packages/server/src/app.ts` board route: one `const today = istDate(clock())`.
- Test: packages/server/test/bugfixApp.test.ts :: BE-015: the rows and "today" come from one reading
- Before the fix: `expected 3 to be 2` (clock reads).
- Guard: the board tests pass.

## BE-016 A PO, style or colour over 200 characters was silently cut
- Root cause: `orderService.text` sliced to 200 characters, so two different long POs collided as duplicates.
- Fix: `packages/server/src/orderService.ts` refuses over 200 with "PO must be at most 200 characters" (also Style, Colour); exactly 200 after trimming is fine.
- Test: packages/server/test/bugfixOrders.test.ts :: BE-016: a %s of 201 characters is a 400 that says so
- Test: packages/server/test/bugfixOrders.test.ts :: BE-016: two long POs that differ only at the end are no longer taken for duplicates
- Before the fix: `expected 201 to be 400`.
- Guard: the 409 duplicate mapping is untouched (`duplicates.test.ts` passes).

## BE-017 A rejected template showed made-up 2031 dates
- Root cause: the engine's order fault names two dates from a probe date (2031-06-20), and `saveTemplate` printed it.
- Fix: `packages/server/src/adminService.ts` drops any engine message that holds a date and states the fault in offsets: `"sewing" would finish before "cutting" (5 working days before ex-factory, against 2)`. Other engine messages (a stage twice, and so on) pass through as before.
- Test: packages/server/test/bugfixOrders.test.ts :: BE-017: the message names the two stages and their offsets and holds no date
- Test: packages/server/test/bugfixOrders.test.ts :: BE-017: two faults are both named
- Before the fix: the message held `(2031-06-14) ... (2031-06-18)`.
- Guard: the DEC-023 check still uses the engine call. One older test changed: a regex in `templateCalendar.test.ts` no longer expects dates for the template message; the order setup message, which has real dates, still matches its own test.

## BE-018 A missing S3 bucket was read as "photo not found"
- Root cause: `isMissing` treated every 404 as a missing photo, including `NoSuchBucket`, with nothing logged.
- Fix: `packages/server/src/s3Store.ts`: `NoSuchBucket` is never "missing"; get and delete throw the fixed "media store unavailable" and call `onError` (operation, name, status only).
- Test: packages/server/test/bugfixMedia.test.ts :: BE-018: a missing bucket is a failure with the fixed message
- Test: packages/server/test/bugfixMedia.test.ts :: BE-018: a missing key is still null on get and a success on delete
- Before the fix: get "promise resolved null instead of rejecting" and `onError` was never called.
- Guard: `s3Store.test.ts` (leak tests, 403 failure, missing object) passes. An unknown-named 404 still means "missing", on purpose, because that test pins it for S3-compatible stores.

## BE-019 Every disk read error was turned into "not found"
- Root cause: the disk store's `get` caught everything.
- Fix: `packages/server/src/mediaStore.ts`: only ENOENT and ENOTDIR (a file used as a folder) give null; any other error is rethrown (the route answers 500 and the log has the cause).
- Test: packages/server/test/bugfixMedia.test.ts :: BE-019: a key that is a folder is an error, not "not found"
- Test: packages/server/test/bugfixMedia.test.ts :: BE-019: a file that is not there, and a folder that is not there, are null
- Before the fix: "promise resolved null instead of rejecting".
- Guard: the shared contract tests for the disk store pass.

## BE-020 An S3 endpoint with a path lost the path silently
- Root cause: `mediaFromEnv` kept only `u.origin`, so requests went to the wrong place.
- Fix: `packages/server/src/mediaFromEnv.ts` refuses a path, query or fragment: "S3_ENDPOINT must be only the address (scheme, host and port), with no path". It names the variable and never prints a value. One trailing slash is still fine.
- Test: packages/server/test/bugfixMedia.test.ts :: BE-020: %s is a MediaConfigError that names the variable and no value
- Test: packages/server/test/bugfixMedia.test.ts :: BE-020: a bare address, with or without the trailing slash, still works
- Before the fix: `expected undefined to be an instance of MediaConfigError`.
- Guard: the environment tests in `s3Store.test.ts` (which pin the trailing-slash case) pass.

## BE-021 HEAD on health and status answered 401
- Root cause: the public list held only GET, but Fastify also answers HEAD for each GET route.
- Fix: `packages/server/src/app.ts`: `HEAD /api/health` and `HEAD /api/status` added to the public list.
- Test: packages/server/test/bugfixApp.test.ts :: BE-021: HEAD %s answers 200 without a sign-in
- Test: packages/server/test/bugfixApp.test.ts :: BE-021: HEAD on a guarded route is still refused
- Before the fix: `expected 401 to be 200`.
- Guard: the sweep that checks every other route is guarded (api and fuzz tests, which use the route list) passes.

## BE-022 The quantity-mismatch message printed equal numbers
- Root cause: a quantity sent as text ("300") or null failed the `!== total` comparison, giving "Quantity 300 does not match ... 300".
- Fix: `packages/server/src/orderService.ts` `createOrder`: null counts as not sent, a non-number says "Quantity must be a number", a number that differs keeps the old message.
- Test: packages/server/test/bugfixOrders.test.ts :: BE-022: a quantity sent as text is told it must be a number
- Test: packages/server/test/bugfixOrders.test.ts :: BE-022: a quantity of null means none was sent
- Before the fix: "Quantity 300 does not match the sizes, which add up to 300"; null gave a 400.
- Guard: the message test in `orders.test.ts` passes.

## BE-023 A mistyped stage told a merchandiser "for your unit"
- Root cause: one message was used for every role.
- Fix: `packages/server/src/eventService.ts` and `photoService.ts`: staff get "No such stage on this order"; supervisors keep "No such stage for your unit" (the stage may exist in another unit and they must not be told more).
- Test: packages/server/test/bugfixEvents.test.ts :: BE-023: a merchandiser who mistypes a stage is not told it is "for your unit"
- Test: packages/server/test/bugfixEvents.test.ts :: BE-023: a supervisor still hears "for your unit"
- Before the fix: `expected 'No such stage for your unit' to be 'No such stage on this order'`.
- Guard: supervisors still cannot see another unit's rows (rls and onBehalf tests pass); the supervisor wording is unchanged.

## BE-024 "Under 300 / 500" was said but exactly 300 / 500 was accepted
- Root cause: the messages said "under N" while N itself is allowed.
- Fix: `packages/server/src/warningService.ts` "Keep the wording to 300 characters or fewer"; `packages/server/src/noteService.ts` "Keep the note to 500 characters or fewer" and "Keep it to 500 characters or fewer". The limits are unchanged.
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-024: 300 characters of wording are accepted; 301 are refused
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-024: a note of exactly 500 characters is accepted
- Before the fix: `expected 'Keep the wording under 300 characters' to be ...`.
- Guard: only words changed; 300 and 500 are accepted and 301 and 501 refused, as before.

## BE-025 Alerts of one refresh came back in random order; the red subject used a lower-case stage
- Root cause: `outbox.created_at` defaults to `now()` (the start of the transaction), so rows of one refresh tied and the sort fell to random ids; the subject used the raw stage name.
- Fix: `packages/server/src/outboxService.ts` `writeOutbox` writes `created_at = clock_timestamp()`; the batch insert in `warningService.ts` stamps each row `clock_timestamp()` plus n microseconds; the red subject uses `cap(stage)`: "PO B-PO-88240: Sewing is red". No migration.
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-025: alerts written by one refresh are listed newest first
- Test: packages/server/test/bugfixWarnings.test.ts :: BE-025: the red alert subject names the stage the way its body does
- Before the fix: `expected [ ...7 ] to deeply equal [ ...7 ]` (order) and `expected 'PO B-PO-88240: sewing is red' to be ...`.
- Guard: the outbox is still insert-only (`outbox.test.ts` passes; its subject line now expects 'Sewing is red'). Without the microsecond step the test passed only about half the time on PGlite.

## BE-026 Creating a template answered 200
- Root cause: the handler returned the body with the default status.
- Fix: `packages/server/src/app.ts`: 201 when the request has no `id` (a create), 200 when it changes an existing template.
- Test: packages/server/test/bugfixApp.test.ts :: BE-026: a new template is 201
- Test: packages/server/test/bugfixApp.test.ts :: BE-026: changing an existing one is 200
- Before the fix: `expected 200 to be 201`.
- Guard: two create checks in `templateCalendar.test.ts` expected 200 and were changed to 201; nothing else reads this status.

## BE-027 Creating an order did not bring the warnings up to date
- Root cause: no `refreshAfter` call after `createOrder`, against the comment on `refreshAfter`.
- Fix: `packages/server/src/app.ts`: `await refreshAfter(req)` after the order commits (as the system; it never fails the create). Since the speed-up O-2 this is a refresh of that one order.
- Test: packages/server/test/bugfixApp.test.ts :: BE-027: an order that is already late has its warning when it is created
- Test: packages/server/test/bugfixApp.test.ts :: BE-027: a failing refresh never fails the order
- Before the fix: `expected 0 to be greater than 0` (no warning until someone opened the review).
- Guard: nothing is confirmed and nothing goes to a buyer (the test checks there is no buyer outbox row and no confirmed warning).

## BE-028 The export file name could end with a doubled hyphen
- Root cause: `buyerExport.exportFileName` trimmed hyphens and then cut to 40 characters, which could leave `--`.
- Fix: `packages/server/src/buyerExport.ts` cuts first, then trims the hyphens.
- Test: packages/server/test/bugfixOrders.test.ts :: BE-028: a name cut at 40 characters on a separator does not leave "--"
- Test: packages/server/test/bugfixOrders.test.ts :: BE-028: no name makes a doubled hyphen
- Before the fix: the file name was `orders-aaa...a--2026-11-08.csv`.
- Guard: the file-name cases in `csv.test.ts` pass, and "the earlier cases are unchanged" is a test of its own.

## BE-029 Size names were not trimmed
- Root cause: `checkSizes` checked `size.trim()` but stored the raw key, so `" S"` and `"S"` were two sizes.
- Fix: `packages/server/src/orderService.ts`: new `normaliseSizes` trims names and refuses a repeat after trimming ("The size S is listed twice"); `checkSizes` stays as a thin wrapper for the preview; `createOrder` stores the trimmed sizes; the 20-character limit counts the trimmed name.
- Test: packages/server/test/bugfixOrders.test.ts :: BE-029: " S" and "S" are one size, so listing both is refused
- Test: packages/server/test/bugfixOrders.test.ts :: BE-029: a size with spaces around it is stored without them
- Before the fix: both sizes gave a 201 with quantity 300 and `{ ' S ': 100 }` was stored.
- Guard: the size-limit tests in `orders.test.ts` pass.

## BE-030 Unused code, and stage names nobody can type again
- Root cause: `loadTemplateSteps` was exported and never used; `isStageName` only rejected plain control characters, so zero-width characters and edge spaces were allowed.
- Fix: `packages/server/src/orderService.ts` no longer has `loadTemplateSteps`. `packages/server/src/today.ts` `isStageName` also requires the name to equal its own trim (no-break space and BOM count) and refuses format characters (zero-width space, joiners, soft hyphen, bidi marks) and line or paragraph separators. Inner spaces and Tamil letters are fine.
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-030: zero-width characters are refused
- Test: packages/server/test/bugfixEngineData.test.ts :: BE-030: leading and trailing spaces (also no-break spaces) are refused
- Test: packages/server/test/bugfixOrders.test.ts :: BE-030: orderService no longer carries the unused loadTemplateSteps
- Before the fix: `expected true to be false` for the zero-width names; the unused key was present (a weak guard by nature).
- Guard: typecheck is clean and nothing imported the removed function; templates use the same check through BE-013. See Open questions about names already saved.

## BE-031 The purge route answered 503 before the role check
- Root cause: `mediaOr503()` ran while the service call was being built, so a supervisor learnt the server's photo-storage set-up.
- Fix: `packages/server/src/app.ts` purge route checks `isStaff` first (403), then validates `days`, then 503.
- Test: packages/server/test/bugfixPhotos.test.ts :: BE-031: a supervisor on a server with no photo storage gets 403 from the purge, not 503
- Before the fix: 503 `photos_unavailable`.
- Guard: a merchandiser still gets 503 (the same test); the other photo routes allow both staff roles, so the purge was the only place affected. Keep the order role, days, 503 if the photo routes move.

## BE-032 The Bearer word was matched case-sensitively
- Root cause: `startsWith('Bearer ')`.
- Fix: `packages/server/src/app.ts` auth hook reads the header with `/^Bearer +(\S+) *$/i`, which also covers buyer link tokens.
- Test: packages/server/test/bugfixApp.test.ts :: BE-032: "%s <token>" signs in
- Test: packages/server/test/bugfixApp.test.ts :: BE-032: "%s" is still not a sign-in
- Before the fix: `expected 401 to be 200`.
- Guard: "Bearer " with no token, "Bearertoken", "Basic ..." and "Token ..." are still 401; a staff token still cannot open buyer routes and the reverse.

## BE-033 Sign-in told an attacker which supervisor phones exist
- Root cause: a locked real account answered 429 in about 2 ms with no hash work, while an unknown phone was never counted and stayed 401 for ever.
- Fix: `packages/server/src/authService.ts`: wrong tries for unknown names and stopped accounts are counted in a bounded in-memory table (`createFailureTracker`, 10,000 keys, least recent dropped) and lock after the same number of tries with the same 401 then 429; every answer other than a 400 pays one hash; the hash runs outside any transaction. The locked message gains a second sentence telling the person to ask their merchandiser to reset the PIN.
- Test: packages/server/test/bugfixAuth.test.ts :: BE-033: after the same number of tries a real and an unknown phone give the same status, code and words
- Test: packages/server/test/bugfixAuth.test.ts :: BE-033: a locked answer costs a hash, like every other answer
- Test: packages/server/test/bugfixAuth.test.ts :: BE-033: the table that remembers unknown phones and emails stays small
- Before the fix: real phone 429 on the 6th try and unknown 401 every time; a locked answer took 1.2 ms (the test needs more than 15); `createFailureTracker is not a function`.
- Guard: lock, unlock, fresh-tries, count-race and per-address tests in `api.test.ts` and the PIN-reset test in `admin.test.ts` pass; the counter is still `failed_attempts + 1` in SQL. Known gap in Open questions.

## BE-034 Password and PIN checks blocked the server
- Root cause: `scryptSync` blocks the event loop for about 45 ms per attempt.
- Fix: `packages/server/src/auth.ts` adds `verifySecretAsync` and `hashSecretAsync` (`crypto.scrypt` off the main thread) with a limit of 4 at a time and 64 waiting; beyond that `AppError(503, 'busy', ...)`. Sign-in uses only the async ones. The 503 is not counted as a wrong try. The sync functions stay for `adminService`.
- Test: packages/server/test/bugfixAuth.test.ts :: BE-034: sign-in does not block the event loop
- Test: packages/server/test/bugfixAuth.test.ts :: BE-034: no more than the limit run at once
- Test: packages/server/test/bugfixAuth.test.ts :: BE-034: a busy server answers sign-in with 503, not a wrong-PIN count
- Before the fix: longest stall 421 ms (limit 30); the others failed with "not a function".
- Guard: `api.test.ts` and `admin.test.ts` pass. The stall test is a timing test and tripped once on a very busy machine; it passes alone. The web app should show a generic "try again" for the new `busy` code.

## BE-035 Nothing checked the database role at start-up
- Root cause: a pasted owner URL (superuser, bypass-RLS or table owner) silently turned row-level security off.
- Fix: `packages/server/src/pgDb.ts` `assertSafeDbRole` (one line naming the role and each problem, ending "Refusing to start."); `packages/server/src/server.ts` runs it before `buildApp` and before listening. `ALLOW_UNSAFE_DB_ROLE=1` turns it into a warning for local development only; a check that cannot run also refuses, with the reason.
- Test: packages/server/test/bugfixStartup.test.ts :: BE-035: a superuser is refused
- Test: packages/server/test/bugfixStartup.test.ts :: BE-035: the owner of tables is refused
- Test: packages/server/test/bugfixStartup.test.ts :: BE-035: the query sees app_user as safe
- Before the fix: the functions did not exist; against a closed port the server now prints "Could not check the database role: connect ECONNREFUSED ... Refusing to start."
- Guard: the real SQL runs on PGlite with the real migrations. The server now needs the database up at start-up (before, it started and answered 500s). A role that is only a member of the owner role passes.

## BE-036 A supervisor could insert an approved photo with any storage key
- Root cause: the policy `sup_photo_write` (migration 009) bound order, stage, unit and buyer only.
- Fix: `packages/server/db/migrations/016_hardening.sql` recreates the policy with every 009 condition kept, plus not approved, not rejected, not purged, and `storage_key ~ '^photos/[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$'`.
- Test: packages/server/test/bugfixRls.test.ts :: BE-036: refuses a photo that is already approved
- Test: packages/server/test/bugfixRls.test.ts :: BE-036: refuses the storage key %j
- Test: packages/server/test/bugfixRls.test.ts :: BE-036: an ordinary photo upload is still accepted
- Before the fix: every refusal case resolved (the insert was allowed); `rls.test.sql` on migrations 001-015 fails with "FAIL supervisor inserted an approved photo".
- Guard: the stage binding test and `rlsWrites.test.ts` pass (its fixture key became `photos/k.jpg`, no assertion changed). If `savePhoto` ever uses another key shape, supervisor uploads will be refused by the database and `photo.test.ts` will show it.

## BE-037 A supervisor could forge note confirmation, category_by, entered_by and received_at
- Root cause: `sup_note_write` (009) and `sup_events_write` (012) did not constrain those columns.
- Fix: `016_hardening.sql`: the note policy also needs `confirmed_by`/`confirmed_at` null and `category_by` not 'merchandiser'; the events policy needs `received_at = now()` and `entered_by` null or a supervisor of the caller's unit, checked by the small function `account_is_supervisor_of(uuid, uuid)` (security definer, execute for the app role only).
- Test: packages/server/test/bugfixRls.test.ts :: BE-037: refuses a note that is already confirmed
- Test: packages/server/test/bugfixRls.test.ts :: BE-037: refuses a count that names a merchandiser
- Test: packages/server/test/bugfixRls.test.ts :: BE-037: refuses a count with a made-up arrival time
- Before the fix: every refusal case resolved (the insert was allowed).
- Guard: all 009 and 012 conditions are kept; `on_behalf = false` for supervisors still holds; supervisors still see no accounts (a test covers the lookup function). Deviation from the finder's fix (`entered_by is null`) because the service stores the supervisor's own id; see Open questions.

## BE-038 Deferred: the database login role can read columns that must stay internal
- Status: deferred, not fixed. Nothing leaks today because the buyer queries name their columns.
- Design note: (1) cheapest: views `buyer_warning_v`, `buyer_order_v`, `buyer_photo_v`, `buyer_milestone_v` with `security_invoker = on` (Postgres 15 or later, so the row policies still apply) holding only the buyer-safe columns, read by `buyerService` and `buyerExport`, plus a test that fails if those files mention `maths`, `planned_rate` or `sizes`. (2) safer and bigger: a second login role `buyer_reader` with column-level grants, used by a second pool for `/api/buyer/*`; only this makes the database itself refuse `select maths`. Risks: views need Postgres 15 (older versions apply the view owner's rights and skip RLS); a second role needs a second connection string, role creation, CI and deployment changes, and the context calls on that pool. Recommendation: do the second role only if buyers get more routes; until then the test in (1), then views.

## BE-039 The migration 015 backfill updated zero rows
- Root cause: 015's UPDATE ran without the system role while row-level security is forced for the owner (the trap that 014 explains).
- Fix: `016_hardening.sql` repeats the backfill in a DO block that sets `app.role` to `system` for the update and puts it back. It touches only NULL rows, so a value the application set since is never overwritten. 015 itself is untouched (its checksum holds).
- Test: packages/server/test/bugfixRls.test.ts :: BE-039: the backfill reaches old dismissed warnings even when 015 itself could not see them
- Test: packages/server/test/bugfixRls.test.ts :: BE-039: running the backfill again changes nothing that was decided since
- Before the fix: the NULL state left by 015 as a non-superuser owner shows the trap; the post-016 assertion could not pass before 016 existed.
- Guard: every migration still applies as a non-superuser owner (`rls.test.ts`, `migrate.test.ts`).

## BE-040 Email was unique only case-sensitively
- Root cause: `email text unique` compares exactly, while sign-in compares lower-case and takes the first row, with no index for that lookup.
- Fix: `016_hardening.sql` renames case-variant duplicates (the non-stopped account with the lowest id keeps its email; others get `.duplicate-<first 8 characters of the id>`; nothing deleted, no id changes; a notice says how many) and creates the unique index `account_email_lower_key` on `lower(email)`.
- Test: packages/server/test/bugfixRls.test.ts :: BE-040: on a database with case-variant duplicates, keeps one account per email
- Test: packages/server/test/bugfixRls.test.ts :: BE-040: a database without duplicates is unchanged, and the index refuses a case variant
- Test: packages/server/test/bugfixRls.test.ts :: BE-040: the sign-in lookup can use the new index
- Test: packages/server/test/bugfixErrors.test.ts :: BE-040: a case-only email clash answers 409 with the email wording
- Before the fix: the second case-variant insert was accepted ("resolved instead of rejecting").
- Guard: the migration runs as a non-superuser owner; hashes are kept. Renamed people need a new sign-in name (the deploy log says how many).  `errors.ts` now words the new index name like the old one (`bugfixErrors.test.ts`).

## BE-041 A connection failure to localhost printed an empty reason
- Root cause: Node 20 raises an AggregateError with an empty message for `localhost` (IPv6 and IPv4 both refused).
- Fix: `errorReason(e)` in `packages/server/src/db.ts` (message, else code, else the inner errors joined by "; ", else "unknown error"); `packages/server/src/migrate.ts` uses it for the connect and rollback messages; `packages/server/test/helpers.ts` `reasonOf` now is `errorReason`.
- Test: packages/server/test/bugfixStartup.test.ts :: BE-041: errorReason falls back from message to code to the inner errors
- Test: packages/server/test/bugfixStartup.test.ts :: BE-041: the migration runner names the reason when localhost refuses the connection
- Test: packages/server/test/toolingScripts.test.ts :: BE-041: a dead localhost port gives a message that ends in a reason, not in nothing
- Before the fix: `Could not connect to postgres://u:***@localhost:1/x: ` (empty); the helper message ended in `): `.
- Guard: only error text changed; the password stays hidden (the test checks it).

## BE-042 An empty PORT listened on a random port; PORT=abc gave a stack trace
- Root cause: `Number(process.env.PORT ?? 8787)` gives 0 for an empty text and NaN for letters.
- Fix: new `packages/server/src/startup.ts` `parsePort`: unset, empty or blank gives 8787; otherwise plain digits 1 to 65535 or a `StartupConfigError`; `server.ts` prints it with "Refusing to start." and exits 1.
- Test: packages/server/test/bugfixStartup.test.ts :: BE-042: PORT=%j is %j
- Test: packages/server/test/bugfixStartup.test.ts :: BE-042: PORT=%j is refused with a plain message
- Before the fix: the module did not exist; the old code was `Number(process.env.PORT ?? 8787)`.
- Guard: the new file exists because `server.ts` runs code at the top and cannot be imported by a test. Running with `PORT=abc` prints one line.

## BE-043 TRUST_PROXY was honoured only as exactly 1
- Root cause: `process.env.TRUST_PROXY === '1'`, so any other spelling silently put everyone in one sign-in bucket.
- Fix: `packages/server/src/startup.ts` `parseTrustProxy`: unset, empty, 0 or false means none; 1 or true means one proxy; 2 to 10 a hop count; a comma list of addresses or ranges is kept as a list; anything else is a `StartupConfigError` that stops the start. `1` now passes the number 1 to Fastify (trust one hop), not `true` (trust every hop).
- Test: packages/server/test/bugfixStartup.test.ts :: BE-043: TRUST_PROXY=%j means no proxy
- Test: packages/server/test/bugfixStartup.test.ts :: BE-043: TRUST_PROXY=%j trusts that many proxies
- Test: packages/server/test/bugfixStartup.test.ts :: BE-043: TRUST_PROXY=%j is refused with a plain message
- Before the fix: the module did not exist; the old code was `process.env.TRUST_PROXY === '1'`.
- Guard: behind one proxy the results are the same, but a caller-written `X-Forwarded-For` can no longer choose its own address.
- Note: lane C found that Fastify 5.12.8 treats a numeric `trustProxy` as "trust nobody" (it cannot check the immediate peer, so it fails closed). Passing the number straight through meant every visitor behind the proxy shared one sign-in bucket. It was fixed in `packages/server/src/app.ts` by turning a count into the function it stands for (see BE-044).

## BE-044 A caller could pick their own address by writing X-Forwarded-For
- Root cause: with `trustProxy: true` Fastify believed the left-most address of `X-Forwarded-For`, which the caller writes, so the 10-failures limit was bypassed. Also, lane C found that the installed Fastify (5.12.8) treats a numeric `trustProxy` as "trust nobody" (see the note under BE-043).
- Fix: `packages/server/src/app.ts`: `AppOptions.trustProxy` is `boolean | number | string[]` (`server.ts` no longer casts); a number n becomes the function `(address, hop) => hop < n`, `true` means one proxy, a list passes through. The caller key is `req.ip` (the address the nearest trusted proxy saw, read from the end of the header) tidied by `limiterKey`: an IPv4 address written in IPv6 form becomes IPv4, other IPv6 addresses become their /64, junk is shortened. The limiter is its own module, `packages/server/src/loginLimiter.ts`.
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-044: with one proxy in front, writing a different left-most X-Forwarded-For does not reset the budget
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-044: another real caller behind the same proxy has a budget of their own
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-044: with no proxy trusted, X-Forwarded-For is ignored altogether
- Before the fix: a spoofed left-most address got a fresh budget each time. The "another real caller" test fails if the numeric setting is passed to Fastify as it is: with `Fastify({trustProxy: 1})` the address stayed the proxy's own, so everyone shared one bucket.
- Guard: the sign-in tests (`api.test.ts`, `admin.test.ts`, `bugfixAuth.test.ts`) pass unchanged. Risk: with a hop count the server believes the count without checking the immediate peer, so the API port must not be reachable directly; the address-list form (`TRUST_PROXY=10.0.0.0/8`) checks the peer.

## BE-045 The limiter map never forgot an address
- Root cause: the failure map kept one entry per address for ever (about 130 bytes each, unbounded with IPv6).
- Fix: `packages/server/src/loginLimiter.ts`: `blocked` creates nothing; `spend` happens before the wait and returns a `refund` that deletes the entry when the last failure is given back (so a good sign-in, a bad body and a 503 for load leave no entry); at most 10,000 entries (expired ones swept first, then the oldest-spent dropped); a sweep every 60 s on a timer that does not keep the process alive and is cleared by `app.close()`; `app.loginLimiter.size` is exposed for tests.
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-045: a hard cap: a million addresses leave at most
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-045: an entry whose window has ended is removed by the sweep, one still running is not
- Test: packages/server/test/bugfixLimiter.test.ts :: BE-045: a try that spends nothing leaves no entry
- Before the fix: the heap held for 1,000,000 distinct callers was 189 MB (never deleted); now 1.85 MB at the cap.
- Guard: a newcomer still gets all 10 tries when the map is full; the sign-in tests pass unchanged. Risk: an attacker with 10,000 distinct /64 ranges could push a real lock out of the map; the only effect is that the victim's address gets a fresh budget.

## BE-046 A database transaction was held while the photo store was read or written
- Root cause: the photo routes called the store inside the transaction (one of 10 connections) and the pool had no timeouts, so ten slow store calls froze the API.
- Fix: `packages/server/src/photoService.ts`: reads look the key up in a short transaction, give the connection back, then call the store; an upload is a short check, then `store.put` under a fresh random key with nothing open, then a short insert (a lost race, a 409 or a failure takes the stored file back, best effort); the purge handles up to 100 files at a time, deleting files with nothing open and then marking `purged_at` only for those deleted (a failed delete leaves its row unmarked and the first failure is thrown at the end). `packages/server/src/startup.ts` `poolSettings`: 5 connections (`DB_POOL_MAX`), 5 s wait, 60 s idle, 30 s per statement (`DB_STATEMENT_TIMEOUT_MS`), 15 s idle in a transaction; `pgDb.ts` answers `503 busy` when no connection is free in time; `s3Store.ts` timeouts; Fastify `requestTimeout` 120 s.
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: upload, staff read, supervisor read, buyer read and clean-up: zero open transactions at every store call
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: with the store stuck, the API still answers
- Test: packages/server/test/bugfixPhotoIo.test.ts :: BE-046: the store refuses the file: 500, no row, no file
- Test: packages/server/test/optStartup.test.ts :: BE-046: a request that cannot get a connection in time is a 503 "busy"
- Before the fix: a test shows a transaction open at the store call (`BE-046: before the change a transaction was open`). With 150 ms store latency the connection was held 155 ms per upload, and an unrelated request during a 30-upload burst waited 421 ms (see O-7 in `optimised.md`).
- Guard: fault tests cover a failed put, a failed insert, a failed take-back, a lost commit answer, a rollback, five identical uploads at once and a reused upload id; "no row without a file" always holds. `photo.test.ts`, `bugfixPhotos.test.ts`, `s3Store.test.ts` and `buyer.test.ts` pass; one line in `bugfixPhotos.test.ts` (the BE-010 photo test) now calls `savePhoto(db, ...)` instead of `savePhoto(tx, ...)`, same assertions. An upload now costs 8 round trips instead of 5. See Open questions (orphan objects, pool defaults).

## BE-047 An update or photo could be dated any time in the past
- Root cause: only future dates and bad shapes were refused, so a date in year 0001 (or 2002) counted toward the stage.
- Fix: `packages/server/src/eventService.ts` exports `MAX_DAYS_IN_PAST = 366`, `earliestAllowedDate(today)` and `tooOld()`; `submitEvent` and `photoService.ts` `savePhoto` refuse a date earlier than today minus 366 days with 400 `bad_request` "date is more than 366 days in the past". In a batch only that item is rejected.
- Test: packages/server/test/bugfixPastDate.test.ts :: BE-047: an update dated exactly 366 days back is accepted, 367 days back is refused with a plain 400
- Test: packages/server/test/bugfixPastDate.test.ts :: BE-047: in a batch the too-old item is rejected on its own and the rest are kept
- Test: packages/server/test/bugfixPastDate.test.ts :: BE-047: a photo follows the same rule, and a refused one stores no file
- Before the fix: the old date was stored and counted. With the demo clock 2026-11-04, 2025-11-03 (366 days) is accepted and 2025-11-02 (367) is refused with no row written.
- Guard: a future date is still refused in its own words; a merchandiser entering on behalf follows the same rule; the limit moves with the factory day (a test). Risk: a phone offline for more than a year that then syncs loses those updates with a 400, which the phone reads as permanent. The constant is one line.

## BE-048 File names with non-ASCII characters were not checked by the leak guard
- Root cause: `git ls-files` quotes such names (`"caf\303\251.txt"`), so they matched no path rule and could not be read.
- Fix: `scripts/check_repo.mjs` uses `git -c core.quotepath=false ls-files -z` (and `--others --exclude-standard`) and splits on NUL; `check_docs.mjs` also got `quotepath=false`.
- Test: packages/server/test/repoGuard.test.ts :: BE-048: a forbidden file with the name %s is refused once force-added
- Test: packages/server/test/repoGuard.test.ts :: BE-048: a key inside a file with an accented name is found
- Test: packages/server/test/repoGuard.test.ts :: BE-048: an ordinary Tamil-named file is still fine
- Before the fix: exit 0, so a key in a Tamil-named `.pem` passed.
- Guard: the leak guard for ASCII names is unchanged (the existing token table still passes).

## BE-049 The secret patterns missed this project's own secrets
- Root cause: the patterns only knew third-party key shapes.
- Fix: `scripts/check_repo.mjs` `projectSecrets`: a database URL with a real password, a shouted name ending SECRET, PASSWORD, TOKEN, API_KEY, ACCESS_KEY or PRIVATE_KEY with a generated-looking value, and the signed-token shape. Filler words and placeholders (`${..}`, `<..>`, `CHANGE_ME`, a name equal to its own user, test or example words, `process.` code) are allowed. Lower-case keys are deliberately not covered.
- Test: packages/server/test/repoGuard.test.ts :: BE-049: refuses %s
- Test: packages/server/test/repoGuard.test.ts :: BE-049: the placeholders the repo itself uses still pass
- Before the fix: all six sample secrets exited 0.
- Guard: `check_repo` reports ok on the whole real tree (the example env file, the CI file and other tests included).

## BE-050 A build could be released with placeholder text as its public notes
- Root cause: nothing refused placeholder text before tagging or releasing.
- Fix: `PLACEHOLDER` and `placeholdersIn` moved to `scripts/buildInfo.mjs`; `changelog.mjs --tag` refuses a report that holds any; `check_repo.mjs` fails a tagged report with a placeholder (and only warns for one whose tag does not exist yet); `.github/workflows/release.yml` greps the report for the four texts before `gh release create`.
- Test: packages/server/test/toolingScripts.test.ts :: BE-050: --tag refuses a report that was started with only a title
- Test: packages/server/test/toolingScripts.test.ts :: BE-050: check_repo fails a tagged report that holds placeholder text
- Test: packages/server/test/toolingScripts.test.ts :: BE-050: fails, and publishes nothing, when any part of the report still holds placeholder text
- Before the fix: the tag went through with exit 0 and the release published the placeholder.
- Guard: tags are never moved or renumbered; regenerating the build files is byte for byte the same; a test asserts no tagged report in the committed history holds a placeholder.

## BE-051 There was no way to start the real server
- Root cause: `.env.example` said "copy to .env" but nothing reads it; no script started the server; `tsx` was only a dev dependency.
- Fix: `package.json` script `start:api` = `tsx packages/server/src/server.ts`; `tsx` moved to dependencies (lock file updated); `packages/server/.env.example` says nothing loads it and names `npm run start:api` and `npm run migrate`; README Configuration documents the start command and PORT, TRUST_PROXY and ALLOW_UNSAFE_DB_ROLE.
- Test: packages/server/test/toolingScripts.test.ts :: BE-051: start:api runs packages/server/src/server.ts, which exists
- Test: packages/server/test/toolingScripts.test.ts :: BE-051: tsx, which start:api and migrate need, is installed in production
- Test: packages/server/test/toolingScripts.test.ts :: BE-051: .env.example no longer says to copy it to .env
- Before the fix: no `start:api`, `tsx` dev-only, header said "Copy to .env".
- Guard: a test also checks that every `npm run` named in the README exists.

## BE-052 Ordinary release prose was rejected as a secret
- Root cause: `(password|token|...)\s*[:=]\s*\S{6,}` matched any word after the colon, such as "token: cancelled links stop".
- Fix: `scripts/changelog.mjs`: key shapes stay; after "password", "token", "secret" or "api key" and `:` or `=` the value counts only when it looks generated (8 or more characters with a digit, or an inner capital); dates are excluded.
- Test: packages/server/test/toolingScripts.test.ts :: BE-052: ordinary sentences with "token:" and "password =" are accepted
- Test: packages/server/test/toolingScripts.test.ts :: BE-052: a value that looks generated, or a key, is still refused
- Before the fix: the first sentence exited 1.
- Guard: a real secret is still refused (the second test).

## BE-053 Two commits could carry the same InBul id
- Root cause: nothing detected a repeated id; it had already happened for InBul17 and InBul18.
- Fix: new `scripts/inbul.mjs` (`nextInbul`, `findDuplicateInbuls`, `LEGACY_DUPLICATES`); `check_repo.mjs` fails when one id titles two commits; the two old repeats are allowed by commit hash prefix so a third use still fails; `--next-internal` is the highest id in any tag or commit title on any branch, plus one; `--tag` refuses an id another commit already holds.
- Test: packages/server/test/toolingScripts.test.ts :: BE-053: check_repo fails when two commits carry the same InBul id
- Test: packages/server/test/toolingScripts.test.ts :: BE-053: a clash with a commit on another branch is found too
- Test: packages/server/test/toolingScripts.test.ts :: BE-053: the legacy duplicates
- Before the fix: all exited 0 or gave the wrong id.
- Guard: the tag flow for normal commits raises no warning (its own test).

## BE-054 `md/` and `company-a-build-plan.md` could be published with a forced add
- Root cause: they are ignored by `.gitignore` but were not on the forbidden list.
- Fix: `scripts/check_repo.mjs` `FORBIDDEN_PATHS` adds `^md/` and `^company-a-build-plan.md` (repository root only).
- Test: packages/server/test/repoGuard.test.ts :: BE-054: check_repo refuses %s once force-added
- Test: packages/server/test/repoGuard.test.ts :: BE-054: a folder called md deeper in the tree, such as docs/md/, is not the private one
- Before the fix: a force-added private file passed.
- Guard: a folder called `md` deeper in the tree is allowed (second test).

## BE-055 Slow tests used most of the time limit and failed on a busy machine
- Root cause: several tests took 50 to 70 percent of the 30 s limit on an idle machine.
- Fix: `vitest.config.ts`: 60 s default for tests and hooks; `vitest.setup.ts` applies a 120 s limit per file from the list in `scripts/slowTests.mjs` (migrate, rls, ordering, templateCalendar, buyerExport, undoDismiss, fuzz, toolingScripts, repoGuard); `scripts/slowestReporter.mjs` prints the 10 slowest tests when `CI` or `SLOWEST_TESTS` is set; fewer git calls in `toolingScripts.test.ts`.
- Test: packages/server/test/toolingScripts.test.ts :: BE-055: the default is raised but not a blanket five minutes
- Test: packages/server/test/toolingScripts.test.ts :: BE-055: the slowest-tests reporter lists the 10 slowest, slowest first
- Before the fix: the limit was 30 s for everything and no report of the slowest tests existed.
- Guard: in-file timeouts could not be added to other people's slow test files, so the per-file setup does the same without editing them.

## BE-056 The README was out of date
- Root cause: it said photos and notes are not built, omitted two export routes, listed a finished roadmap item and quoted old test counts.
- Fix: `README.md`: those statements corrected; test counts removed; CI table and Testing section updated (the Postgres job, `test:pg`, `TEST_DATABASE_URL`, slow tests); start-up variables, the new error codes, templates answering 201 and the secret-scan list documented.
- Test: packages/server/test/toolingScripts.test.ts :: BE-056: every route the app registers is in the README
- Test: packages/server/test/toolingScripts.test.ts :: BE-056: it no longer says photos and notes are not built
- Test: packages/server/test/toolingScripts.test.ts :: BE-056: npm run verify is not described as everything CI does
- Before the fix: the README said photos and notes were not built.
- Guard: if a route is added later without a README line, the first test fails.

## BE-057 The documentation link check missed many broken links
- Root cause: it ignored anchors, reference links and HTML links, and failed a valid link containing parentheses.
- Fix: `scripts/check_docs.mjs` rewritten: balanced parentheses and `<angle bracket>` targets, `[ref]: target` definitions, `src=` and `href=`, root-relative paths, inline code ignored, and a heading-anchor check (repeat headings, `<a name>`, `#top`). New message `broken anchor <target>`.
- Test: packages/server/test/toolingScripts.test.ts :: BE-057: an anchor that is not a heading of the target file is broken
- Test: packages/server/test/toolingScripts.test.ts :: BE-057: a reference-style link whose definition points at a missing file is broken
- Test: packages/server/test/toolingScripts.test.ts :: BE-057: <angle bracket> targets with a space
- Before the fix: these cases were not reported (or a valid link was reported broken).
- Guard: the older `check_docs` tests are unchanged and green, and the real tree passes. This file and `optimised.md` are checked by the same script.

## BE-058 Non-ASCII file names were written as octal escapes in the public build report
- Root cause: `git diff --name-only` quotes such names.
- Fix: `scripts/changelog.mjs` uses `git -c core.quotepath=false diff --cached --name-only -z`.
- Test: packages/server/test/toolingScripts.test.ts :: BE-058: a staged café.txt and a Tamil-named file are listed by name
- Before the fix: the names appeared as escapes such as `caf\303\251.txt`.
- Guard: ASCII names are unchanged; regenerating the build files stays byte for byte the same.

## BE-059 The scripts acted on the repository in the current folder
- Root cause: they ran git in the working directory, not where the script lives, and crashed with a stack trace outside git.
- Fix: new `scripts/repoRoot.mjs`; `changelog.mjs`, `check_repo.mjs` and `check_docs.mjs` use the repository that holds the script (`git -C <script folder>`); outside git, changelog and check_repo print one line and exit 1 (check_docs keeps its walk-the-folder fallback); an unknown option, or two modes at once, is one plain line.
- Test: packages/server/test/toolingScripts.test.ts :: BE-059: changelog and check_repo started from another repository still act on the one that holds them
- Test: packages/server/test/toolingScripts.test.ts :: BE-059: %s outside any git repository says so in one line
- Test: packages/server/test/toolingScripts.test.ts :: BE-059: an unknown option, or two modes at once, is one plain line
- Before the fix: the scripts acted on the wrong repository or crashed.
- Guard: behaviour change on purpose: `--next-build --next-internal` together is now an error (before, only the first was printed). Every temporary repository in the tests gets its own copy of the scripts.

## BE-060 `npm run typecheck` did not cover `scripts/` or the config files
- Root cause: one `tsconfig.json` without the scripts, and server code compiled with browser types.
- Fix: new `tsconfig.scripts.json` (JavaScript checked, Node types only) covers `scripts/*.mjs`, `.d.mts`, `vitest.config.ts` and `vitest.setup.ts`; new `tsconfig.server.json` checks engine and server source and tests without browser types; `npm run typecheck` runs all three. The scripts of the UI session are skipped by name, with a comment.
- Test: packages/server/test/toolingScripts.test.ts :: BE-060: npm run typecheck runs all three configs
- Test: packages/server/test/toolingScripts.test.ts :: BE-060: every file in scripts/ is type-checked or explicitly skipped
- Test: packages/server/test/toolingScripts.test.ts :: BE-060: server code is checked without browser types, and neither config loosens strict
- Before the fix: `typecheck` named one config and the scripts were not in it.
- Guard: changelog, check_repo and check_docs were annotated with JSDoc only (no behaviour change) and a few possible-null reads fixed. A script with a `.d.mts` beside it is read through its declarations only (a TypeScript rule).

## BE-061 The test helper ordered migrations differently from production
- Root cause: the helper picked and ordered migration files by its own rule, and `resetAndSeed` restored only one setting.
- Fix: `packages/server/test/helpers.ts` imports `readMigrations` and `MIGRATIONS_DIR` from `src/migrate.ts` (`migrationFiles` is the production list and order); `resetAndSeed` restores the whole settings table to what the migrations seeded.
- Test: packages/server/test/toolingScripts.test.ts :: BE-061: the helper lists the migrations the way production does
- Test: packages/server/test/toolingScripts.test.ts :: BE-061: resetAndSeed puts every setting back as the migrations seeded it
- Before the fix: the helper and the runner disagreed on order and file choice, and changed settings leaked between tests.
- Guard: the full server run passes with the new helpers, including migration 016 (and later 017).

## BE-062 CI could cancel a push run, a release ran no checks, and the banned-terms guard could be silently off
- Root cause: one concurrency group cancelled the first run of two pushes to `main`; `release.yml` ran no checks; an empty banned-terms list was quietly accepted on fork and Dependabot runs.
- Fix: `.github/workflows/ci.yml`: a group per commit for pushes, cancel only for pull requests, `REQUIRE_BANNED_TERMS` on for pushes and same-repository pull requests, and a `check_bugs` step. `release.yml`: trigger `build-[0-9]*`, a new `verify` job (full history, `npm run check` with the guard required, typecheck, tests), the release job `needs: verify`, write permission on the release job only. `scripts/check_repo.mjs`: `REQUIRE_BANNED_TERMS=1` with an empty list fails; on Actions an empty, not-required list prints a warning.
- Test: packages/server/test/repoGuard.test.ts :: BE-062: the banned-terms guard can be made to fail loudly
- Test: packages/server/test/toolingScripts.test.ts :: BE-062: a push to main is never cancelled by the next one; a pull request still is
- Test: packages/server/test/toolingScripts.test.ts :: BE-062: a release needs the checks, and runs them with the banned-terms guard required
- Before the fix: the workflow files had none of these rules (the tests read the workflow YAML).
- Guard: the repository secret `BANNED_TERMS` must exist, otherwise pushes to `main` and build tags now fail on purpose. Requiring the tagged commit to be on `main` was not done (a build was once tagged on a branch before the merge).

## BE-063 A build tag from another branch failed the repo check everywhere
- Root cause: `check_repo.mjs` demanded `docs/builds/<tag>.md` for every `build-N` tag in the repository, but a tag lives in the whole repository while the report lives on the branch that made the release. The UI release tag reached the remote before its branch was merged, so `main` and every other branch failed.
- Fix: the report is required only when the tagged commit is part of the checked-out history (`git merge-base --is-ancestor`). Only a definite "not in this history" skips the check; when git cannot tell (a shallow clone, an error) the tag is treated as reachable, the strict way.
- Test: packages/server/test/toolingScripts.test.ts :: BE-063: a tag on another branch is ignored
- Before the fix: `FAIL tag build-1000: no report docs/builds/build-1000.md` for a tag that only exists on another branch.
- Guard: BE-050 and the existing tag-without-report test still fail a tag on this history with no report (checked in the same test: `build-1001` on this history still fails).

## Open questions

Where a report and the code differ, the code was trusted. Nothing below changes a status in `bug.md`; every listed id is marked fixed unless said otherwise.

1. BE-033 (marked fixed; one part remains by design): the answers no longer reveal which phones exist, but anyone who knows a phone can still lock that supervisor for 15 minutes with 5 wrong tries from any address. Fixing this needs a decision (for example backing off per account and per caller). The table of unknown names is per process and holds 10,000 keys.
2. BE-037: `entered_by` is checked as "null or a supervisor of the caller's unit", not "exactly the caller", because the database does not know the caller's account id. Exact would need an `account id` in the request context (`Ctx`, `CONTEXT_SQL`, `app.ts`). `created_at` on photos and notes, and `photo.bytes`, `photo.client_uuid`, `note.audio_key`, `note.confidence`, are still free for a supervisor to set.
3. BE-004: a figure typed on behalf for today changes produced and remaining at once but does not move the pace (DEC-021), so it is not flagged until it becomes a finished day. If the owner wants it flagged the same day, it is a one-line addition in `confidence.ts`. Three older tests in `onBehalf.test.ts` were edited because they pinned the old rule.
4. BE-043 and BE-044: `TRUST_PROXY` as a hop count is believed without checking the immediate peer (Fastify cannot check it), so the API port must be closed to the outside; the address-list form checks the peer and is preferred when the proxy address is known. The README and `.env.example` text for `TRUST_PROXY` was written by the BE-043 work and not changed by the BE-044 work.
5. BE-046: orphan photo objects. After a crash between the store write and the database insert (or a failed take-back) an object can stay in the store with no row. It sits under a random name and is only wasted space, but nothing sweeps it; a periodic "objects older than a day with no photo row" sweep is not written. The pool defaults (5 connections, 5 s wait before a 503 `busy`, 30 s per statement) are chosen for one or two processors and can be changed with `DB_POOL_MAX` and `DB_STATEMENT_TIMEOUT_MS`. The purge now throws the first failed delete after marking the files that were deleted (before, the whole transaction rolled back); the success answer is unchanged. The pool and shutdown wiring in `server.ts` itself is not run by a test, and nothing was run against a real Postgres.
5a. BE-047: a phone that was offline for more than a year and then syncs loses those updates with a 400. The limit is one constant (`MAX_DAYS_IN_PAST`).
6. BE-062: a repository secret `BANNED_TERMS` must be set, or pushes to `main` and build tags fail on purpose.
7. Not run on a real Postgres (no `TEST_DATABASE_URL`): the concurrency claims of BE-008 and BE-012 rest on Postgres re-checking the UPDATE's WHERE after the row lock (the "in flight together" tests prove only the one-after-another case on PGlite); the security-definer function of BE-037 under forced row-level security. Let the CI job `test-postgres` run them.
8. BE-002/BE-006: rows already in the database outside 2000 to 2100 are not rewritten or refused at read time (they no longer stall anything); `calendar.from/to` of the order page are not clamped; `previousWorkingDay`, `workingDayOnOrBefore` and `workingDaysBack` keep their small loops.
9. BE-030: zero-width joiners are refused too (Tamil needs none today). A template already saved with such a name, or with edge spaces, now gets a 400 on updates and photos for that stage; worth a look at existing data. Trimming at save time is done through BE-013.
10. BE-035: the server now needs the database to be reachable at start-up. A login role that is only a member of the owner role passes the check; tables owned in other schemas are not counted.
11. BE-008: a reworded re-confirm sends a second email with the new words, on purpose.
12. BE-034 and BE-033: the web app should show "try again in a moment" for the new sign-in code `busy` (503); the locked message now has a second sentence. This is the UI session's change.
13. Test-first record: the API-level tests of BE-002, BE-003, BE-005 and BE-006 (`bugfixEngineDataApi.test.ts`) were written with or just after the fix; their unit-level twins were seen failing first. Where a test passed before the fix on purpose (it guards behaviour that must stay), the Before line says so or the entry's Guard does.
14. Left alone because they are not logged bugs: `.gitignore` additions (`*.dump`, `*.sqlite`, `.claude/`), and the bash lookup in the release tests on Windows with a per-user Git install.
