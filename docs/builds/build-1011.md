# Build 1011: Dark theme, several reasons for a slow day, safer date changes and one back button

Date: 2026-11-10
Tag: build-1011

<!-- manual:start -->
## What changed

Supervisors: a slow day can have several reasons, not one (tap each that applies: the note writes itself from your choices, in your language, and you can change it; tap "Rewrite from my choices" to get the written note back). Update and Today now lead with the pieces made, then what was added today in one quiet line, then what is left; after Send the line says what you added ("Saved: 120 pieces added to today, with a note"). A day with no output can be sent as 0 with a reason; "12,5" is no longer read as 125; the number field is not hidden under the top bar on a short screen; a bad photo no longer leaves "Photo ready" beside an error; after a lost reply the phone says "trying again" and retries within seconds; signing out with updates waiting asks first; "Stitching" and "Printing" have Tamil on every screen (draft words, unreviewed). Merchandisers: the order page timeline fits the screen with the ex-factory line in view; Add an update refuses more than the whole stage and asks once before accepting more than is left; moving the ex-factory date asks first and refuses a date more than two years ahead or a year back, and the history shows the year; Cancel link, Back to normal on a closed day and Hide from buyer ask first; search finds colour; Review shows every reason a supervisor chose, the first marked "Main reason", and says when a note was written from those choices. Everyone: a dark theme you choose from the menu (light stays the default: the floor reads these screens in daylight); the same back control on every page; stricter rules for passwords and for characters in names and PO numbers; photos whose hidden data cannot be read are refused; sign-in tries are counted per address and account, so one person's wrong tries do not lock a whole factory out; a strict browser security policy; and an audit report with a plan of action (audit/AUDIT-04-user-perspective.md, audit/POA-AUDIT-04.md).

## Why

A final round of checks by four independent audits of the whole app found no way to read another buyer's data, and the fixes from them went in with tests. A friend's review of the Update form asked for several reasons, a note that does not have to be typed, and a finished area that acknowledges the work. People who use the floor screens in bright light needed a choice of theme without the status colours changing. And a user's-eye audit (a supervisor, a merchandiser, a buyer and a first-time evaluator) showed where a real person gets stuck: it is written up, with a plan, so the next builds can answer it.

## How it was checked

On the combined result the full automated suite passes (2,863 tests, 16 skipped that need a real Postgres), the accessibility audit finds nothing serious on 48 screens, the layout audit is clean at 55 screen widths including 195 px in Tamil, and the offline browser test passes 23 of 23 with the strict security policy enforced. The new form was driven end to end in a browser: three reasons in order, a hand edit kept when a chip is tapped, the written note restored on request, then the merchandiser's Review screen showing the same reasons. The dark theme was checked colour pair by colour pair (31 pairs pass in both themes). After the deploy the live app was checked: sign-ins for every role, the board, the buyer pages and the new note fields. Not checked: a real phone in daylight, an iPhone, a low-end phone, a screen reader, the photo viewer in dark, the database change on a real Postgres (only the in-memory one), and supervisors reading the new Tamil: the words added since build 1010 are drafts, unreviewed, and listed in audit/TAMIL-REVIEW.md.

## Next improvement

Let a buyer see where an order stands (on track or not, which stage, last updated) and what changed, including date changes, which buyers' compliance teams asked for; let a merchandiser cancel or fix a mistyped order; keep a supervisor's unsent number and note when she leaves the screen, and let her see and correct what she sent; make the demo data look the same to every reviewer; one name for the ship date everywhere; the top bar in the new three-shape design. The plan is in audit/POA-AUDIT-04.md.
<!-- manual:end -->

## Files changed

- README.md
- deployment.md
- docs/status.md
- package-lock.json
- packages/design/tokens.css
- packages/engine/package.json
- packages/engine/src/index.ts
- packages/engine/src/reasonNote.ts
- packages/engine/test/reasonNote.test.ts
- packages/server/db/migrations/021_note_reasons.sql
- packages/server/src/adminService.ts
- packages/server/src/app.ts
- packages/server/src/buyerService.ts
- packages/server/src/demoSeed.ts
- packages/server/src/jpegMeta.ts
- packages/server/src/loginLimiter.ts
- packages/server/src/noteService.ts
- packages/server/src/orderService.ts
- packages/server/src/photoService.ts
- packages/server/src/textRules.ts
- packages/server/test/api.test.ts
- packages/server/test/bugfixFinalHeaders.test.ts
- packages/server/test/bugfixFinalJpeg.test.ts
- packages/server/test/bugfixFinalLimiter.test.ts
- packages/server/test/bugfixFinalPassword.test.ts
- packages/server/test/bugfixFinalText.test.ts
- packages/server/test/bugfixFormReasons.test.ts
- packages/server/test/bugfixLimiter.test.ts
- packages/server/test/migrate.test.ts
- packages/server/test/notes.test.ts
- packages/web/index.html
- packages/web/package.json
- packages/web/public/sw.js
- packages/web/public/theme-init.js
- packages/web/src/board/boardLogic.ts
- packages/web/src/dates.ts
- packages/web/src/i18n.ts
- packages/web/src/main.tsx
- packages/web/src/notes/noteDraft.ts
- packages/web/src/notes/reasons.ts
- packages/web/src/orders/orderDetailLogic.ts
- packages/web/src/orders/orderForm.ts
- packages/web/src/orders/visitEntry.ts
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/Buyer.tsx
- packages/web/src/pages/Login.tsx
- packages/web/src/pages/NotFound.tsx
- packages/web/src/pages/OrderDetail.tsx
- packages/web/src/pages/OrderSetup.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Status.tsx
- packages/web/src/pages/Today.tsx
- packages/web/src/pages/Update.tsx
- packages/web/src/queue/controller.ts
- packages/web/src/queue/types.ts
- packages/web/src/review/noteAiLogic.ts
- packages/web/src/review/noteReasons.ts
- packages/web/src/setup/DaysTab.tsx
- packages/web/src/setup/PeopleTab.tsx
- packages/web/src/setup/setupLogic.ts
- packages/web/src/styles.css
- packages/web/src/ui/AppBar.tsx
- packages/web/src/ui/StageTimeline.tsx
- packages/web/src/ui/ThemeMenuItem.tsx
- packages/web/src/ui/VisitEntryForm.tsx
- packages/web/src/ui/atoms/CheckMark.tsx
- packages/web/src/ui/molecules/ActionBar.css
- packages/web/src/ui/molecules/BackLink.css
- packages/web/src/ui/molecules/BackLink.tsx
- packages/web/src/ui/molecules/ReasonChips.css
- packages/web/src/ui/molecules/ReasonChips.tsx
- packages/web/src/ui/molecules/ReasonList.css
- packages/web/src/ui/molecules/ReasonList.tsx
- packages/web/src/ui/organisms/AddPersonForm.tsx
- packages/web/src/ui/organisms/OrderBento.css
- packages/web/src/ui/organisms/StageCard.css
- packages/web/src/ui/organisms/StageCard.tsx
- packages/web/src/ui/organisms/UpdateHero.css
- packages/web/src/ui/organisms/UpdateHero.tsx
- packages/web/src/ui/syncStatus.ts
- packages/web/src/ui/theme.ts
- packages/web/test/a11y.test.ts
- packages/web/test/backLink.test.tsx
- packages/web/test/boardSearch.test.ts
- packages/web/test/bootShell.test.ts
- packages/web/test/bugcycleFsInstall.test.ts
- packages/web/test/bugcycleFsLayout.test.ts
- packages/web/test/bugcycleFsNotFound.test.tsx
- packages/web/test/bugcycleFsNumbers.test.ts
- packages/web/test/bugcycleFsQueue.test.ts
- packages/web/test/bugcycleFsSignOut.test.ts
- packages/web/test/bugcycleMerchandiser.test.ts
- packages/web/test/csp.test.ts
- packages/web/test/darkTheme.test.ts
- packages/web/test/finalF4OrderForm.test.ts
- packages/web/test/finishedArea.test.tsx
- packages/web/test/focusAfterAction.test.ts
- packages/web/test/logic.test.ts
- packages/web/test/merchandiserPolish.test.ts
- packages/web/test/noStatusTints.test.ts
- packages/web/test/noteDraft.test.ts
- packages/web/test/notes.test.ts
- packages/web/test/orderBento.test.tsx
- packages/web/test/orderForm.test.ts
- packages/web/test/reasonChips.test.tsx
- packages/web/test/reasonsMulti.test.ts
- packages/web/test/reviewNoteReasons.test.ts
- packages/web/test/reviewNoteReasons.test.tsx
- packages/web/test/reviewUndo.test.tsx
- packages/web/test/stageCardNarrow.test.ts
- packages/web/test/supervisorPolish.test.ts
- packages/web/test/supervisorRedesign.test.tsx
- packages/web/test/tapTargets.test.ts
- packages/web/test/theme.test.tsx
- packages/web/test/updateForm.test.ts
- packages/web/vite.config.ts
- scripts/a11y.ts
- scripts/check_contrast.mjs
- scripts/csp.d.mts
- scripts/csp.mjs
- scripts/e2e_offline.ts
- scripts/vercel_build.mjs
