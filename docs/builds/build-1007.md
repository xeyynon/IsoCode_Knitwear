# Build 1007: Supervisors keep Send in reach, and merchandisers get tabs and a phone-friendly board

Date: 2026-11-08
Tag: build-1007

<!-- manual:start -->
## What changed

On a phone, a supervisor's Send button now stays at the bottom of the screen, above the keyboard, so it is always in reach once the number is typed. The sign-in opens on the form that phone used last (a phone already in Tamil opens the supervisor form), shows Tamil and English side by side, and a button that cannot be used yet is a clear grey. Today says how many of the day's stages have an update and which date the counts go to, and after a send the next stage is one tap away. Merchandisers get Board, Review and Setup as tabs on every screen, with the number waiting for review always in view. The People table keeps its words whole, and on a phone the board's filters sit behind one Filters button, so the first order appears much higher. This build also carries the board, order and Setup improvements made since build 1006 that were not yet released.

## Why

Audits on a phone and on a desktop found that Send sat below seven reason buttons, the sign-in opened on the wrong form for a Tamil-reading supervisor, and the board spent three quarters of a phone's first screen on controls. The product depends on supervisors sending a daily count, so each of these costs real updates.

## How it was checked

The full automated suite passes (1431 tests), the accessibility audit finds nothing serious on 48 screens, and the offline browser test passes 22 of 22. The supervisor flow was tried on a real Android phone over USB (keyboard open, Send above it, sign-in, Tamil) and the merchandiser screens with touch emulation. Every new rule was written as a test first and seen to fail on the old code. Not checked: an iPhone, a low-end phone, the merchandiser screens on a real phone, a screen reader, and the new Tamil, which is a draft that supervisors have not read.

## Next improvement

Supervisors read and correct the draft Tamil; then the remaining merchandiser screens (order progress in pieces, key facts on the order page, one number and date format), and trying everything on a real low-end phone.
<!-- manual:end -->

## Files changed

- README.md
- frontendskill.md
- packages/web/index.html
- packages/web/public/sw.js
- packages/web/src/App.tsx
- packages/web/src/api/download.ts
- packages/web/src/api/session.ts
- packages/web/src/api/sessionRules.ts
- packages/web/src/board/boardLogic.ts
- packages/web/src/board/filterPanel.ts
- packages/web/src/dates.ts
- packages/web/src/fonts.ts
- packages/web/src/i18n.ts
- packages/web/src/langRules.ts
- packages/web/src/loginRules.ts
- packages/web/src/main.tsx
- packages/web/src/notes/reasons.ts
- packages/web/src/orders/orderDetailLogic.ts
- packages/web/src/orders/timelineLayout.ts
- packages/web/src/orders/visitEntry.ts
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/Buyer.tsx
- packages/web/src/pages/Login.tsx
- packages/web/src/pages/OrderDetail.tsx
- packages/web/src/pages/OrderSetup.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Setup.tsx
- packages/web/src/pages/Status.tsx
- packages/web/src/pages/Today.tsx
- packages/web/src/pages/Update.tsx
- packages/web/src/photo/orientation.ts
- packages/web/src/photo/resize.ts
- packages/web/src/queue/controller.ts
- packages/web/src/queue/oneAtATime.ts
- packages/web/src/queue/storageStatus.ts
- packages/web/src/queue/sync.ts
- packages/web/src/queue/types.ts
- packages/web/src/release/buildInfo.ts
- packages/web/src/release/releaseInfo.ts
- packages/web/src/review/exportLogic.ts
- packages/web/src/review/reviewLogic.ts
- packages/web/src/setup/AlertsTab.tsx
- packages/web/src/setup/DaysTab.tsx
- packages/web/src/setup/PeopleTab.tsx
- packages/web/src/setup/TemplatesTab.tsx
- packages/web/src/setup/alertLogic.ts
- packages/web/src/setup/setupLogic.ts
- packages/web/src/stages/dayProgress.ts
- packages/web/src/stages/stageLink.ts
- packages/web/src/stages/useStages.ts
- packages/web/src/styles.css
- packages/web/src/ui/AppBar.tsx
- packages/web/src/ui/AuthImage.tsx
- packages/web/src/ui/ChunkErrorBoundary.tsx
- packages/web/src/ui/ConfirmDialog.tsx
- packages/web/src/ui/LoadFailed.tsx
- packages/web/src/ui/Loading.tsx
- packages/web/src/ui/LowConfidence.tsx
- packages/web/src/ui/PhotoViewer.tsx
- packages/web/src/ui/Shortcuts.tsx
- packages/web/src/ui/StageTimeline.tsx
- packages/web/src/ui/StatusBadge.tsx
- packages/web/src/ui/SyncChip.tsx
- packages/web/src/ui/UpdateBanner.tsx
- packages/web/src/ui/VisitEntryForm.tsx
- packages/web/src/ui/WhatsNewDialog.tsx
- packages/web/src/ui/bottomSlot.ts
- packages/web/src/ui/confirmAsker.ts
- packages/web/src/ui/molecules/ActionBar.css
- packages/web/src/ui/molecules/ActionBar.tsx
- packages/web/src/ui/molecules/NavTabs.css
- packages/web/src/ui/molecules/NavTabs.tsx
- packages/web/src/ui/navRules.ts
- packages/web/src/ui/shortcutKeys.ts
- packages/web/src/ui/swUpdate.ts
- packages/web/src/ui/swUpdateStore.ts
- packages/web/src/ui/syncStatus.ts
- packages/web/src/ui/unsentInput.ts
- packages/web/src/ui/useNarrow.ts
- packages/web/src/ui/useReviewCount.ts
- packages/web/test/a11y.test.ts
- packages/web/test/actionBar.test.tsx
- packages/web/test/actionBarGuards.test.ts
- packages/web/test/alerts.test.ts
- packages/web/test/boardFilters.test.ts
- packages/web/test/boardLive.test.ts
- packages/web/test/boardScope.test.ts
- packages/web/test/boardSearch.test.ts
- packages/web/test/buyerExport.test.ts
- packages/web/test/buyerNotice.test.ts
- packages/web/test/confirmAsker.test.ts
- packages/web/test/dayProgress.test.ts
- packages/web/test/designGuards.test.ts
- packages/web/test/focusAfterAction.test.ts
- packages/web/test/i18n.test.ts
- packages/web/test/langDefault.test.ts
- packages/web/test/logic.test.ts
- packages/web/test/loginRules.test.ts
- packages/web/test/navRules.test.ts
- packages/web/test/navTabs.test.tsx
- packages/web/test/orderDetail.test.ts
- packages/web/test/orderSetupFocus.test.ts
- packages/web/test/owner.test.ts
- packages/web/test/peopleTable.test.ts
- packages/web/test/photoOrientation.test.ts
- packages/web/test/photoQueue.test.ts
- packages/web/test/queue.test.ts
- packages/web/test/releaseInfo.test.ts
- packages/web/test/review.test.ts
- packages/web/test/saveFailed.test.ts
- packages/web/test/savedDay.test.ts
- packages/web/test/sendOnce.test.ts
- packages/web/test/setup.test.ts
- packages/web/test/shortcuts.test.ts
- packages/web/test/stageLink.test.ts
- packages/web/test/statusColours.test.ts
- packages/web/test/supervisorPolish.test.ts
- packages/web/test/swUpdate.test.ts
- packages/web/test/swVersion.test.ts
- packages/web/test/tapTargets.test.ts
- packages/web/test/timelineLayout.test.ts
- packages/web/test/unreachable.test.ts
- packages/web/test/visitEntry.test.ts
- packages/web/vite.config.ts
