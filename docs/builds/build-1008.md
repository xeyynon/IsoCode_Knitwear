# Build 1008: A calm violet look, status stamps, a dashboard for merchandisers and a bolder Today for supervisors

Date: 2026-11-08
Tag: build-1008

<!-- manual:start -->
## What changed

Supervisors: Today opens with a ring and "N of M updated today", then one large card per stage showing the pieces made against the pieces planned and one big Update button; the Update screen has larger numbers, a plain "left", and a back button shaped like the menu button; the sync chip is marked for a moment when it changes ("3 waiting" to "All sent"); the Update screen fits in Tamil at the largest phone font and at 200% zoom; a "page not found" screen with a way back, in Tamil for supervisors; a "Skip to main content" link as the first stop for the keyboard (the Tamil wording of both is a draft, unreviewed); when there is nothing to update the screen says that new orders appear when the merchandiser sets them up; a ring shows straight away when the app starts on a slow connection, and Today shows grey blocks while its list loads. Merchandisers: the board's status filter is a row of tiles with the number in each and the pieces short; each order's progress bar on the board is now by pieces of the current stage ("Sewing: 1,750 of 4,550 pieces"), says so in words when nothing is reported yet, and labels an estimate; search, sort, buyer, unit and ship week sit in one toolbar and a very long buyer name no longer stretches a row; "Don't show" on a warning still waiting for review can be undone in the page (a confirmed warning cannot); cancelled and expired buyer links are folded away; an order opens with tiles for quantity, ex-factory date (with the weekday), stages done and projected finish, with the timeline and the stage cards side by side; Change date is no longer a second filled button; the review headings are clearer; the status page shows the day and time zone and a way back; a new order shows a dash, not a zero, until a size has a number; Setup opens on a pilot checklist and has one Add a person form and a list of account activity. Everyone: every order status is drawn as a ruled stamp (icon, word and colour, no coloured fills); the app has one soft violet theme; form errors are no longer red but dark with a drawn "!"; piece counts are written one way (1,750 and 1,25,000); a date field reads its date back in words.

## Why

Audits of the supervisor's phone and of the merchandiser's desktop found that the main actions were out of reach, the board and the order page buried the numbers people open them for, and several screens looked alike and busy. The first round of fixes did not look different enough, and coloured status fills looked machine-made, so the look was reworked: colour now sits only on a status's icon, word and stamp, the rest is calm, and loading and empty screens say what is happening.

## How it was checked

On the combined result the full automated suite passes (1784 tests, 16 skipped), the accessibility audit finds nothing serious on 48 screens, the layout audit is clean at five screen widths plus a 195 px width for Tamil at 200% zoom, which now also measures content that runs past its own card (no sideways overflow, no control under the touch size), the offline browser test passes 22 of 22, and the screens were looked at in a browser with touch emulation at phone size and at desktop size. Start-up times were measured on an emulated slow network and a slower processor (first visit on Slow 3G: first content after 3.3 seconds; sign-in to the list 2.0 seconds; a later visit with the app stored, the list after about 1 to 1.5 seconds); this is emulation, not a real phone on a real network. Not checked: a real phone in daylight (soft tints can wash out in glare), an iPhone, a low-end phone, a screen reader, the photo viewer and the What's new dialog with the new look, orders with several stages, the Activity list for stopped, allowed and reset accounts, and supervisors reading the new Tamil: the words added since build 1007 are drafts, unreviewed, and listed in audit/TAMIL-REVIEW.md.

## Next improvement

Supervisors read and correct the draft Tamil; try the Today and Update screens on a real phone in daylight; retake the interface pictures; decide what to do about cancelled buyer links piling up and about the same status shown three times on the order page.
<!-- manual:end -->

## Files changed

- README.md
- frontendskill.md
- package.json
- packages/design/tokens.css
- packages/server/db/migrations/015_warning_undo.sql
- packages/server/src/app.ts
- packages/server/src/boardService.ts
- packages/server/src/index.ts
- packages/server/src/warningService.ts
- packages/server/test/boardPieces.test.ts
- packages/server/test/buyer.test.ts
- packages/server/test/migrate.test.ts
- packages/server/test/templateCalendar.test.ts
- packages/server/test/undoDismiss.test.ts
- packages/web/index.html
- packages/web/src/App.tsx
- packages/web/src/board/boardLogic.ts
- packages/web/src/board/progressText.ts
- packages/web/src/dateWords.ts
- packages/web/src/i18n.ts
- packages/web/src/numberFormat.ts
- packages/web/src/orders/visitEntry.ts
- packages/web/src/pages/Board.css
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/Buyer.tsx
- packages/web/src/pages/Login.tsx
- packages/web/src/pages/NotFound.tsx
- packages/web/src/pages/OrderDetail.tsx
- packages/web/src/pages/OrderSetup.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Setup.tsx
- packages/web/src/pages/Status.tsx
- packages/web/src/pages/Today.tsx
- packages/web/src/pages/Update.tsx
- packages/web/src/review/reviewLogic.ts
- packages/web/src/review/undoLogic.ts
- packages/web/src/setup/AlertsTab.tsx
- packages/web/src/setup/DaysTab.tsx
- packages/web/src/setup/PeopleTab.tsx
- packages/web/src/setup/TemplatesTab.tsx
- packages/web/src/setup/activityLogic.ts
- packages/web/src/setup/addPerson.ts
- packages/web/src/setup/setupChecklist.ts
- packages/web/src/setup/useSetupChecklist.ts
- packages/web/src/stages/pieceProgress.ts
- packages/web/src/statusRules.ts
- packages/web/src/styles.css
- packages/web/src/ui/AppBar.css
- packages/web/src/ui/AppBar.tsx
- packages/web/src/ui/ChunkErrorBoundary.tsx
- packages/web/src/ui/ConfirmDialog.tsx
- packages/web/src/ui/LoadFailed.tsx
- packages/web/src/ui/PhotoViewer.tsx
- packages/web/src/ui/README.md
- packages/web/src/ui/Shortcuts.tsx
- packages/web/src/ui/StatusBadge.tsx
- packages/web/src/ui/StatusStamp.css
- packages/web/src/ui/SyncChip.css
- packages/web/src/ui/SyncChip.tsx
- packages/web/src/ui/UpdateBanner.tsx
- packages/web/src/ui/VisitEntryForm.tsx
- packages/web/src/ui/WhatsNewDialog.tsx
- packages/web/src/ui/atoms/Banner.tsx
- packages/web/src/ui/atoms/Button.tsx
- packages/web/src/ui/atoms/Card.tsx
- packages/web/src/ui/atoms/Chip.tsx
- packages/web/src/ui/atoms/DateWords.css
- packages/web/src/ui/atoms/DateWords.tsx
- packages/web/src/ui/atoms/ErrorText.tsx
- packages/web/src/ui/atoms/Input.tsx
- packages/web/src/ui/atoms/PieceBar.css
- packages/web/src/ui/atoms/PieceBar.tsx
- packages/web/src/ui/atoms/ProgressRing.css
- packages/web/src/ui/atoms/ProgressRing.tsx
- packages/web/src/ui/atoms/Skeleton.css
- packages/web/src/ui/atoms/Skeleton.tsx
- packages/web/src/ui/atoms/SkipLink.css
- packages/web/src/ui/atoms/SkipLink.tsx
- packages/web/src/ui/atoms/TextLink.tsx
- packages/web/src/ui/atoms/cx.ts
- packages/web/src/ui/molecules/Field.tsx
- packages/web/src/ui/molecules/InlineUndo.css
- packages/web/src/ui/molecules/InlineUndo.tsx
- packages/web/src/ui/organisms/AccountActivity.css
- packages/web/src/ui/organisms/AccountActivity.tsx
- packages/web/src/ui/organisms/AddPersonForm.css
- packages/web/src/ui/organisms/AddPersonForm.tsx
- packages/web/src/ui/organisms/KeyFacts.css
- packages/web/src/ui/organisms/KeyFacts.tsx
- packages/web/src/ui/organisms/OrderBento.css
- packages/web/src/ui/organisms/OrderBento.tsx
- packages/web/src/ui/organisms/SetupChecklist.css
- packages/web/src/ui/organisms/SetupChecklist.tsx
- packages/web/src/ui/organisms/StageCard.css
- packages/web/src/ui/organisms/StageCard.tsx
- packages/web/src/ui/organisms/StatusTiles.css
- packages/web/src/ui/organisms/StatusTiles.tsx
- packages/web/src/ui/organisms/TodayHero.css
- packages/web/src/ui/organisms/TodayHero.tsx
- packages/web/src/ui/organisms/UpdateHero.css
- packages/web/src/ui/organisms/UpdateHero.tsx
- packages/web/src/ui/syncNotice.ts
- packages/web/src/ui/templates/AuthShell.tsx
- packages/web/src/ui/templates/MerchandiserShell.tsx
- packages/web/src/ui/templates/PublicShell.tsx
- packages/web/src/ui/templates/SupervisorShell.tsx
- packages/web/test/accountActivity.test.tsx
- packages/web/test/actionBarGuards.test.ts
- packages/web/test/addPerson.test.ts
- packages/web/test/atoms.test.tsx
- packages/web/test/audit03Polish.test.ts
- packages/web/test/boardProgress.test.ts
- packages/web/test/bootShell.test.ts
- packages/web/test/dashboardBoard.test.ts
- packages/web/test/dateWords.test.tsx
- packages/web/test/dayProgress.test.ts
- packages/web/test/emptyStates.test.ts
- packages/web/test/focusAfterAction.test.ts
- packages/web/test/inlineUndo.test.tsx
- packages/web/test/keyFacts.test.tsx
- packages/web/test/merchandiserPolish.test.ts
- packages/web/test/narrowScreens.test.ts
- packages/web/test/navRules.test.ts
- packages/web/test/noStatusTints.test.ts
- packages/web/test/numberFormat.test.ts
- packages/web/test/orderBento.test.tsx
- packages/web/test/pieceProgress.test.ts
- packages/web/test/review.test.ts
- packages/web/test/reviewLinksFold.test.tsx
- packages/web/test/reviewUndo.test.tsx
- packages/web/test/setupChecklist.test.ts
- packages/web/test/setupPhase5.test.tsx
- packages/web/test/skeleton.test.tsx
- packages/web/test/skipLinkNotFound.test.tsx
- packages/web/test/statusStamp.test.tsx
- packages/web/test/statusTiles.test.tsx
- packages/web/test/supervisorPolish.test.ts
- packages/web/test/supervisorRedesign.test.tsx
- packages/web/test/syncNotice.test.tsx
- packages/web/test/templates.test.tsx
- packages/web/test/undoLogic.test.ts
- scripts/check_contrast.mjs
- scripts/load_metrics.ts
- scripts/snapshots.ts
- scripts/ux_metrics.ts
