# Build 1006: Set up the pilot: people, holidays, templates, and a lost phone in one click

Date: 2026-11-03
Tag: build-1006

<!-- manual:start -->
## What changed

A merchandiser can now add supervisors and merchandisers (easy PINs like 1234 are refused), reset a PIN, sign someone out on every phone at once, or stop an account, and it takes effect on the very next request. Units, closed days for each unit (Deepavali, a shutdown, an extra day worked) and the stage lists used to schedule orders can all be set up from a Setup screen. An approved photo can be withdrawn from the screen, and the files of old rejected photos can be cleared. If two supervisors share a phone, one person's waiting updates are never sent under the other's sign-in, and the screen says so.

## Why

Until now a real supervisor, a holiday or a stage list could only be created by editing the database, so the pilot could not start. A lost phone or a leaver also had no answer short of signing everyone out.

## How it was checked

Played through in Microsoft Edge: a weak PIN was refused then a strong one accepted, the new supervisor saw only their own unit, resetting their PIN signed out their running session and refused the old PIN, stopping the account signed them out, a closed day moved the board from 467 to 560 pieces a day and back, a template with stages out of order was explained and refused, a saved template scheduled a new order correctly, and on a shared phone the second person's sign-in did not send the first person's update, which went out when the first person signed back in. The offline browser test passes 22 of 22. 511 automated tests pass; each of the new safety rules was broken on purpose to confirm tests catch it. A fresh clone of the repository was also installed, checked, tested and built from scratch. Not checked: real Postgres, a real phone, or the client's real people, units and calendars.

## Next improvement

Get the real people, units, holiday calendars and stage lists from the client, have supervisors correct the Tamil, and try everything on a real low-end phone.
<!-- manual:end -->

## Files changed

- README.md
- packages/server/db/migrations/007_admin.sql
- packages/server/src/adminService.ts
- packages/server/src/app.ts
- packages/server/src/auth.ts
- packages/server/src/authService.ts
- packages/server/src/index.ts
- packages/server/src/photoService.ts
- packages/server/test/admin.test.ts
- packages/web/src/App.tsx
- packages/web/src/api/sessionRules.ts
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Setup.tsx
- packages/web/src/queue/controller.ts
- packages/web/src/queue/instance.ts
- packages/web/src/queue/sync.ts
- packages/web/src/queue/types.ts
- packages/web/src/setup/DaysTab.tsx
- packages/web/src/setup/PeopleTab.tsx
- packages/web/src/setup/TemplatesTab.tsx
- packages/web/src/setup/setupLogic.ts
- packages/web/src/styles.css
- packages/web/src/ui/SyncChip.tsx
- packages/web/test/owner.test.ts
- packages/web/test/setup.test.ts
- scripts/snapshots.ts
- uiux/03-board-desktop.png
- uiux/04-board-filtered-red.png
- uiux/05-board-menu-open.png
- uiux/06-board-greyscale.png
- uiux/07-board-tamil.png
- uiux/09-board-phone.png
- uiux/16-today-offline-waiting-phone.png
- uiux/29-setup-people.png
- uiux/30-setup-closed-days.png
- uiux/31-setup-template-editor.png
- uiux/README.md
