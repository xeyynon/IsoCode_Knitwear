# Build 1000: Sign in and the order board

Date: 2026-11-03
Tag: build-1000

<!-- manual:start -->
## What changed

Merchandisers can sign in and see every order on one board, worst first, with the working behind each colour (for example: need 467 a day, making 350 a day, 700 pieces short by 11 Nov). Filter by status or buyer; the filters stay in the address. Supervisors can sign in with a phone number and PIN, and the Tamil status words are shown. A public status page shows whether the system is working.

## Why

This is the first screen the people running the orders can use. It shows which orders will ship late and why, so nobody has to chase the floor by phone.

## How it was checked

Driven in Microsoft Edge against the real API on an in-memory Postgres with illustrative data: sign-in, wrong-password handling, board contents and order, status filter surviving a reload, menu keyboard behaviour, Tamil, the phone layout (found and fixed a layout bug), greyscale view, and a supervisor being kept off the board. 158 automated tests pass. Not checked: real Postgres, real devices, a real merchandiser reading the board, or the Tamil words with supervisors.

## Next improvement

Supervisor daily update screen with the offline queue, then order setup and order detail screens.
<!-- manual:end -->

## Files changed

- .github/workflows/release.yml
- package-lock.json
- package.json
- packages/server/src/dev.ts
- packages/web/index.html
- packages/web/package.json
- packages/web/src/App.tsx
- packages/web/src/api/session.ts
- packages/web/src/api/sessionRules.ts
- packages/web/src/board/boardLogic.ts
- packages/web/src/i18n.ts
- packages/web/src/main.tsx
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/Login.tsx
- packages/web/src/pages/Status.tsx
- packages/web/src/pages/Today.tsx
- packages/web/src/styles.css
- packages/web/src/ui/AppBar.tsx
- packages/web/src/ui/ChunkErrorBoundary.tsx
- packages/web/src/ui/Loading.tsx
- packages/web/src/ui/StatusBadge.tsx
- packages/web/src/ui/chunkReload.ts
- packages/web/src/vite-env.d.ts
- packages/web/test/logic.test.ts
- packages/web/vite.config.ts
- scripts/changelog.mjs
- scripts/check_repo.mjs
- tsconfig.json
