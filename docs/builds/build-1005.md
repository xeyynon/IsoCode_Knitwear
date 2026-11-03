# Build 1005: Say why a stage is slow: a reason and a note, in Tamil or English

Date: 2026-11-03
Tag: build-1005

<!-- manual:start -->
## What changed

A supervisor can now add to a daily update a reason (one tap from a short list: not enough workers, workers on leave, machine problem, material late, no power, fixing quality, something else) and a few typed words in Tamil or English. They travel with the update, even with no signal, and arrive exactly once. A merchandiser reviews each note in the review queue, adds the English meaning of a Tamil note and checks the reason; notes also appear on the order's page. Notes are internal and never shown to buyers. An update can now only attach a photo that really belongs to that order.

## Why

Numbers say a stage is behind; the supervisor's own words say why. This captures that in Tamil, keeps the original beside the English, and keeps a person in charge of the meaning instead of trusting an automatic translation.

## How it was checked

Played through in Microsoft Edge: the reason picker in English and Tamil, a Tamil note saved with no signal and delivered on reconnect, a merchandiser adding the English meaning and changing the reason (recorded as theirs), the notes on the order page, and a buyer page with nothing from the notes. The offline browser test passes 22 of 22. 407 automated tests pass; the reason list, photo ownership, the repeat check, the buyer barrier and the never-overwrite-the-original rule were each broken on purpose to confirm tests catch them. Not checked: Tamil typed on a real phone keyboard, the Tamil wording with supervisors, real Postgres. Not built: voice notes and automatic translation.

## Next improvement

Tamil wording for the whole supervisor screen reviewed by supervisors, trying everything on a real low-end phone, and a template editor.
<!-- manual:end -->

## Files changed

- README.md
- packages/server/db/migrations/006_notes.sql
- packages/server/src/app.ts
- packages/server/src/eventService.ts
- packages/server/src/index.ts
- packages/server/src/noteService.ts
- packages/server/src/orderDetailService.ts
- packages/server/test/notes.test.ts
- packages/web/src/i18n.ts
- packages/web/src/notes/reasons.ts
- packages/web/src/pages/OrderDetail.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Update.tsx
- packages/web/src/queue/sync.ts
- packages/web/src/queue/types.ts
- packages/web/src/stages/useStages.ts
- packages/web/src/styles.css
- packages/web/test/notes.test.ts
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
- uiux/21-order-detail.png
- uiux/22-order-detail-phone.png
- uiux/24-review-queue.png
- uiux/27-update-photo-ready-phone.png
- uiux/28-update-reason-note-tamil-phone.png
- uiux/README.md
