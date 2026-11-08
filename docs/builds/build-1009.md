# Build 1009: Safer and cheaper to run: a bug round on the backend, faster updates, and photos without location data

Date: 2026-11-08
Tag: build-1009

<!-- manual:start -->
## What changed

After every update the server now recomputes only the order that changed instead of every order, so sending an update and opening the board are much quicker and cheaper to run. A long audit found and fixed dozens of small bugs: a stage exactly on pace could show red, a warning could be emailed to a buyer twice, a mistyped date far in the future could freeze the server, a blank purge value could delete every rejected photo, and sign-in revealed which phone numbers have an account. Photos are stripped of camera and location data before they are stored, two people changing the same ship date at once no longer garble its history, and a wrong storage address is refused at start-up. Pages that people reload every minute are now compressed and sent only when they changed.

## Why

Every update was recomputing all orders, which would have made the server slow and costly as the number of orders grows, and the audit found places where the server could be confused, frozen or made to reveal more than it should.

## How it was checked

Every fix has a test written first that failed before the fix. The full suite passes (2,382 tests), including the database tests on a real Postgres 16 in CI.

## Next improvement

Check the lock and race fixes on a real Postgres under load, decide whether supervisor phone numbers must be Indian mobiles, and try the app on real phones.
<!-- manual:end -->

## Files changed

- .gitignore
- README.md
- package.json
- packages/server/src/app.ts
- packages/server/src/authService.ts
- packages/server/src/jpegMeta.ts
- packages/server/src/mediaFromEnv.ts
- packages/server/src/orderService.ts
- packages/server/src/photoService.ts
- packages/server/test/bugfixPhotoIo.test.ts
- packages/server/test/bugfixRound2Auth.test.ts
- packages/server/test/bugfixRound2Cors.test.ts
- packages/server/test/bugfixRound2Docs.test.ts
- packages/server/test/bugfixRound2Endpoint.test.ts
- packages/server/test/bugfixRound2Exif.test.ts
- packages/server/test/bugfixRound2Locks.test.ts
- packages/server/test/bugfixRound2Repo.test.ts
- packages/server/test/optHttpCache.test.ts
- packages/server/test/toolingScripts.test.ts
- scripts/check_repo.mjs
- scripts/inbul.mjs
