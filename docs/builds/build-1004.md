# Build 1004: A photo with the daily update, and a steadier daily rate

Date: 2026-11-03
Tag: build-1004

<!-- manual:start -->
## What changed

A supervisor can add a photo to a daily update. The phone shrinks it first (a large camera picture becomes roughly 150 KB) and sends it with the update, even after a lost signal or a lost reply, without ever making a duplicate. A merchandiser approves or rejects it in the review queue, and a buyer sees only approved photos of their own orders. Separately, the daily rate is now worked out from completed days, so a small update sent in the morning no longer drags a late-risk order's rate down and raises a false warning.

## Why

Photos are the proof a buyer wants to see, and they have to survive a weak signal without ever being lost or duplicated. The rate fix stops false warnings from reaching the review queue every morning.

## How it was checked

Played through in Microsoft Edge: a 782 KB photo became 148 KB, the buyer saw nothing before approval and a decoded picture after, a photo taken offline went up when the signal returned, and a file that is not a picture was refused in plain words. The offline browser test passes 21 of 21, including three photos taken with no signal and two upload replies lost on purpose, which still stored exactly three photos each linked to its own update. 362 automated tests pass; the photo rules, both layers of buyer protection, and the new rate rule were each broken on purpose to confirm tests catch them. Not checked: a real phone camera (rotation and capture on real devices), real Postgres, or a cloud photo store.

## Next improvement

Typed and voice notes in Tamil, with Tamil wording for the whole supervisor screen reviewed by supervisors, then trying it on real low-end phones.
<!-- manual:end -->

## Files changed

- README.md
- packages/engine/src/index.ts
- packages/engine/test/engine.test.ts
- packages/server/.env.example
- packages/server/db/migrations/005_photos.sql
- packages/server/src/app.ts
- packages/server/src/buyerService.ts
- packages/server/src/demo.ts
- packages/server/src/index.ts
- packages/server/src/mediaStore.ts
- packages/server/src/photoService.ts
- packages/server/src/server.ts
- packages/server/test/photo.test.ts
- packages/web/src/api/session.ts
- packages/web/src/pages/Buyer.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Update.tsx
- packages/web/src/photo/resize.ts
- packages/web/src/queue/controller.ts
- packages/web/src/queue/instance.ts
- packages/web/src/queue/sync.ts
- packages/web/src/queue/types.ts
- packages/web/src/styles.css
- packages/web/src/ui/AuthImage.tsx
- packages/web/test/photoQueue.test.ts
- scripts/e2e_offline.ts
- scripts/snapshots.ts
- uiux/03-board-desktop.png
- uiux/04-board-filtered-red.png
- uiux/05-board-menu-open.png
- uiux/06-board-greyscale.png
- uiux/07-board-tamil.png
- uiux/09-board-phone.png
- uiux/13-update-empty-phone.png
- uiux/14-update-confirm-too-many.png
- uiux/15-update-offline-saved.png
- uiux/16-today-offline-waiting-phone.png
- uiux/24-review-queue.png
- uiux/27-update-photo-ready-phone.png
- uiux/README.md
