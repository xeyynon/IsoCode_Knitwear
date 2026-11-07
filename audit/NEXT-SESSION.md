# Start a new UI/UX 2.0 session with this

Paste this as the first message, in the repo folder:

> You are continuing the UI/UX 2.0 work on the order-tracking app (React PWA for Tamil-speaking floor supervisors on cheap Android phones, merchandisers on desktop, read-only buyers). Read, in this order: `frontendskill.md` (section 2 hard rules and section 11 traps are binding), `audit/POA-UIUX.md` (the plan; section 5 slices, section 6 definition of done, section 7 decisions), `audit/PROGRESS.md` (what is done and measured), `audit/STATE-TABLES.md`, `packages/web/src/ui/README.md` (component rules). Then run `npm run ux` for the current numbers.
>
> Lanes: you own `packages/web`, `packages/design`, `uiux`, `audit`, `frontendskill.md`, `scripts/snapshots.ts`, `scripts/ux_metrics.ts`, `scripts/check_contrast.mjs`. A separate backend session owns `packages/engine`, `packages/server`, the release `.mjs` scripts and CI (`md/poa_backend.md`): do not edit those; if the UI needs an API change, write the contract request in `md/api.md` terms and say so. Both sessions work in this one checkout: **never `git add -A`, never switch branch, stage by file name only, commit only when the user asks.**
>
> Method for every slice: test first and watch it fail; make the change with the existing classes and tokens (no literal colours; Tamil never guessed: new supervisor words get draft Tamil marked unreviewed, kept in one list); break the fix once to prove a test fails; typecheck and run the affected tests; look in a real browser at 390x844 **with touch emulation** and 1280x900, in English and Tamil; run `npm run ux`, `npm run a11y`, and `E2E_API_PORT=8799 npm run e2e` when the supervisor flow changed; add a dated entry to `audit/PROGRESS.md` with measured before and after and what was not checked. Merchandiser sign-in on the demo needs the browser clock set to the API's time (see `frontendskill.md` section 3). Say what was not tried in the same message as what was.
>
> Ask before: a new runtime dependency, anything that changes the status model, a commit or push, and decision D5 (merchandiser navigation in the app bar) if the user has not answered.

Where things are, in one line each:
- Plan and decisions: `audit/POA-UIUX.md`; the decision record: `md/decisions.md` DEC-027 (check the last number before adding one; the other session adds them too).
- Pictures: `uiux/1.0` (frozen), `uiux/2.0` (current, previous sets in `2.0/previous/`); audit screenshots in `audit/`. Nothing is ever deleted.
- Registers of what failed and what worked: `md/tried_and_failed.md`, `md/tried_and_implemented.md`.
- The guides this plan took ideas from (TARANG, ORCA, Dukaan Dost, Calley) are summarised in `POA-UIUX.md` section 8b.
