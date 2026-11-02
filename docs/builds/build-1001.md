# Build 1001: Supervisor daily update that works with no signal

Date: 2026-11-03
Tag: build-1001

<!-- manual:start -->
## What changed

Supervisors now see their own orders and stages in My orders today, tap one, type the pieces made and send. The update is saved on the phone first and sent when there is signal, with a chip showing All sent or how many are waiting. The app itself opens with no signal and shows the last saved list. Updates survive closing and reopening the app, a failed send can always be retried safely without counting twice, and an update the server refuses is kept with the reason instead of vanishing. Warnings appear if the phone cannot keep updates safely or storage is almost full.

## Why

Signal on the shop floor is unreliable, and a supervisor's count must never be lost or counted twice. This is the part of the system that decides whether people keep using it.

## How it was checked

Run in Microsoft Edge at phone size against the real API: the app opens offline after a reload, 20 updates entered offline show as 20 waiting, none reach the server until the signal returns, the app is restarted while still offline and all 20 are still waiting, then all 20 arrive exactly once with the pieces adding up exactly. A server reply was also lost on purpose after the server had stored the updates, and retrying did not double count. 202 automated tests pass. Not checked: a real low-end phone, a real mobile network, the Tamil wording with supervisors, photos or notes, or two supervisors sharing one phone.

## Next improvement

Add a photo and a short note to an update, test on a real low-end Android phone, and have supervisors correct the Tamil.
<!-- manual:end -->

## Files changed

- README.md
- package.json
- packages/server/src/app.ts
- packages/server/src/demo.ts
- packages/server/src/dev.ts
- packages/server/src/index.ts
- packages/server/src/myService.ts
- packages/server/test/my.test.ts
- packages/web/public/sw.js
- packages/web/src/App.tsx
- packages/web/src/dates.ts
- packages/web/src/i18n.ts
- packages/web/src/main.tsx
- packages/web/src/pages/Today.tsx
- packages/web/src/pages/Update.tsx
- packages/web/src/queue/controller.ts
- packages/web/src/queue/idbStore.ts
- packages/web/src/queue/instance.ts
- packages/web/src/queue/storageStatus.ts
- packages/web/src/queue/sync.ts
- packages/web/src/queue/types.ts
- packages/web/src/stages/useStages.ts
- packages/web/src/styles.css
- packages/web/src/ui/SyncChip.tsx
- packages/web/test/logic.test.ts
- packages/web/test/queue.test.ts
- packages/web/vite.config.ts
- scripts/e2e_offline.ts
