# Build 1003: Nothing reaches a buyer until you confirm it, and a buyer sees only their own orders

Date: 2026-11-03
Tag: build-1003

<!-- manual:start -->
## What changed

Warnings about at-risk stages now wait in a review queue. A merchandiser reads the wording a buyer would see (kept free of internal figures), can reword it, then confirms it or hides it; changing a stage's colour needs a fresh look. Merchandisers can make a private link for one buyer contact, set how long it works, and cancel it. The buyer opens it with no sign-in and sees only their own orders, planned dates and confirmed warnings, read-only. A link opens nothing else, and a missing, unknown, cancelled or expired link all give the same message.

## Why

Buyers must never see another buyer's data or unreviewed claims about their own orders. This puts a person in the loop before anything leaves the factory and proves the separation with automated tests.

## How it was checked

Played through in Microsoft Edge in two separate browser sessions: the buyer saw no warning before it was confirmed, saw only the reworded text after, lost it when it was hidden, and was refused once the link was cancelled; the link's secret disappeared from the address bar on load. 314 automated tests pass, including 34 buyer-isolation tests run against 17 routes, and the isolation rules were broken on purpose five different ways to confirm the tests catch each. The offline supervisor browser test still passes after this change. Not checked: real Postgres, a real buyer contact reading it, or photos (photo upload is not built, so a buyer's photo list is always empty).

## Next improvement

Photo upload with approval in the review queue, then typed and voice notes in Tamil.
<!-- manual:end -->

## Files changed

- README.md
- packages/server/db/migrations/004_review_and_links.sql
- packages/server/db/tests/rls.test.sql
- packages/server/src/app.ts
- packages/server/src/buyerService.ts
- packages/server/src/index.ts
- packages/server/src/warningService.ts
- packages/server/test/buyer.test.ts
- packages/server/test/review.test.ts
- packages/web/src/App.tsx
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/Buyer.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/review/reviewLogic.ts
- packages/web/src/styles.css
- packages/web/test/review.test.ts
- packages/web/vite.config.ts
- scripts/snapshots.ts
- uiux/03-board-desktop.png
- uiux/04-board-filtered-red.png
- uiux/05-board-menu-open.png
- uiux/06-board-greyscale.png
- uiux/07-board-tamil.png
- uiux/09-board-phone.png
- uiux/16-today-offline-waiting-phone.png
- uiux/24-review-queue.png
- uiux/25-buyer-view-phone.png
- uiux/26-buyer-link-not-valid.png
- uiux/README.md
