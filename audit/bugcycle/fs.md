# Final bug cycle, stream FS: supervisor findings (9 Nov 2026)

Branch `bugcycle-fs`, from `main` at `3bbabf0`. Source: the supervisor hunter's report (FE-S-nn) and three items from the reviewer-path hunter (FE-D-01, FE-D-09, FE-D-10). Every fix was written test first (red, then green); each regression test name starts with its id. Pictures are in `audit/bugcycle/fs/`.

| Id | Status | What changed | Test (file :: name starts with) |
| --- | --- | --- | --- |
| FE-S-01 | fixed | `stage.stitching` and `stage.printing` have Tamil labels, so the brief's own stage names are no longer English on Tamil screens. "Stitching" reuses the word the app already has for sewing (தையல்); "Printing" is a draft (பிரிண்டிங்), listed in `audit/TAMIL-REVIEW.md`. A test lists every stage name the seed uses and fails for one with no Tamil. | `test/bugcycleFsNumbers.test.ts :: FE-S-01` |
| FE-S-02 | fixed | A supervisor can send 0 pieces for a day (the server already accepted it). `parsePieces(raw, min)` takes a minimum: 0 on the Update screen, 1 by default (the merchandiser's visit entry keeps needing at least 1). Decimals, negatives and text are still refused with the same message. | `bugcycleFsNumbers.test.ts :: FE-S-02` |
| FE-S-03 | fixed | The page keeps the sticky app bar's height free at the top (`scroll-padding-top`) as well as room for the bar at the bottom. Measured at 360x300 with the keyboard simulated: the field's top moved from 42 px to 78 px (the app bar ends at 65 px), so 23 to 24 px that were hidden under the bar are now 0. | `test/bugcycleFsLayout.test.ts :: FE-S-03` |
| FE-S-04 | skipped | Today lists every open stage of the unit. Whether a supervisor may report an early stage (parallel work, a stage started ahead) is a product rule I cannot derive from the data, so hiding "not started" stages could hide real work. Left as a product decision. | none |
| FE-S-05 | fixed | After a good photo, a bad file now drops the earlier photo too, so the error is never shown beside "Photo ready"; focus goes to the Add button. | `bugcycleFsLayout.test.ts :: FE-S-05` (and `focusAfterAction.test.ts`, count 2 to 3, same promise) |
| FE-S-06 | fixed | After a failed sync the phone retries by itself after 3 s, 8 s, then 20 s (not only on the 30 s timer), and the chip says "N waiting · trying again" for the first failure; the honest "could not send" shows from the second failure in a row. The same id is sent again, so the server stores it once. | `test/bugcycleFsQueue.test.ts :: FE-S-06` |
| FE-S-07 | fixed | A supervisor who signs out with updates waiting is asked first (the updates stay saved and send after the next sign-in); the sign-in screen says how many updates are waiting on the phone. The menu now closes before the question opens. | `test/bugcycleFsSignOut.test.ts :: FE-S-07` |
| FE-S-08 | fixed | The not-found page for someone not signed in uses the chosen language and the existing Tamil keys (and "Sign in" in Tamil). | `test/bugcycleFsNotFound.test.tsx :: FE-S-08` |
| FE-S-09 | not mine | The sign-in limiter belongs to the backend stream. | n/a |
| FE-S-10 | fixed | A comma counts only as a thousands separator in a valid grouping (1,250 · 12,500 · 1,25,000); "12,5" and "12 5" are refused with the whole-number message instead of being read as 125. | `bugcycleFsNumbers.test.ts :: FE-S-10` |
| FE-S-11 | skipped | A product note (no undo for a wrong count smaller than what is left); the history is append-only by design. | none |
| FE-D-01 | fixed | The app now has a web app manifest (`public/manifest.webmanifest`: name, short name, start page, standalone, colours from the tokens, 192 and 512 px icons and a maskable icon). The icons are flat (the action colour with a white ring and check, no gradient). Edge reads the manifest with no errors; its installability check reports only "in incognito" (a private browsing context). The icons are not in the service worker's list: the files are small and only needed to install, not to run offline. | `test/bugcycleFsInstall.test.ts :: FE-D-01` |
| FE-D-09 | fixed | A real favicon (SVG and a 32 px PNG), an apple-touch-icon (180 px) and a meta description replace the blank data: icon. Not done: the live app's unknown paths return HTTP 200 and it has no Content-Security-Policy header: both are hosting or server settings outside this stream. | `bugcycleFsInstall.test.ts :: FE-D-09` |
| FE-D-10 | fixed | The Evaluator panel's "Use these" is a full-width 48 px band between the two rows (it was a 28 px pill on the seam); the unit chips keep the touch size too. Measured 314 x 48 and the icons 48 x 48 on a phone. | `bugcycleFsLayout.test.ts :: FE-D-10` |

## Draft Tamil added (unreviewed; each has a row in `audit/TAMIL-REVIEW.md`)
`stage.printing`, `stage.stitching` (reuse), `sync.retrying`, `nav.signOutWaitingTitle`, `nav.signOutWaiting`, `nav.signOutStay`, `login.waiting`. `err.notFound*` and `login.title` are existing keys.

## Mutation checks (each guard was broken on purpose, seen failing, then restored)
FE-S-03 (scroll-padding-top removed: guard failed, and the browser measure went back to 42 px), FE-S-05 (`setPhoto(null)` removed from the failed pick), FE-S-02 (Update asking for the default minimum again), FE-D-10 (the pill put back).

## Checks on this branch
`npm run verify` 2446 tests passed (16 skipped), typecheck clean; `npm run a11y` nothing serious on 48 screens; `npm run ux` 55 of 55 screen-widths clean, 0 controls under the tap size; `E2E_API_PORT=8832 npm run e2e` 22 of 22. In Edge with touch: Update with 0 typed keeps Send enabled; Send and the number field are 56 px and nothing overflows at 390, 320 and 195 px in English and Tamil.

## Not checked
A real phone (the keyboard case is a resized viewport), an iPhone's install prompt (Safari uses the apple-touch-icon and has no install criteria like Chrome's), the manifest on the live host, Tamil words with supervisors, FE-S-06 against a real lost reply on a real network (the queue test fakes the lost reply; the earlier hunter run saw the server store it once).
