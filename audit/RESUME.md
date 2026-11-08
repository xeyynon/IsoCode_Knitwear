# Resume point, 8 Nov 2026 (written when the work was paused)

Read this first, then `audit/POA-UIUX.md`, `audit/PROGRESS.md` and `audit/AUDIT-03-ui-2-0.md`.

## Where things stand
- Branch `frontend-audit`, tip = the commit that adds this file. **Pushed to origin up to `d3b7705` (tag InBul18).** Not pushed yet: the docs merge (`446de04`, Build 1008 record), the merge of `origin/main` (backend: board pieces, undo of Don't show), the AUDIT-03 merge, and this file. Push with `git push origin frontend-audit` after a check.
- Done and merged: phases 0, 1, 3 (except 3.4), 4 (except 4.1), 5 (checklist, Add a person, Activity), the redesign (supervisor hero and stage cards, merchandiser board tiles and order bento), the Pantone Violet theme, the status stamp everywhere, the theme sweep, the docs and the Build 1008 record, AUDIT-03.
- Last full check on the merged tree (before AUDIT-03 was added, which is files only): `npm run verify` 1657 tests passed (16 skipped); a11y, ux and e2e were green on `d3b7705`.

## Unfinished
1. **Stream `ui2-atoms`** (phase 2 atoms and phase 6 templates), branch `ui2-atoms` in the worktree `.claude/worktrees/agent-a0afa7e312e15772e`, **locked and still running when paused**. It replaces hand-written buttons, fields, cards and alerts page by page (the order: atoms + Login, Today and Update, Board, OrderDetail/Review/Setup/OrderSetup/Buyer, then templates), each slice proven by the pixel diff. Check its commits with `git log ui2-atoms` and its `audit/PROGRESS.md` entry. If it stopped half way, finish the slices it did not do; do not merge a slice without its `npm run diff` result. If the agent is gone, the worktree can be unlocked with `git worktree unlock`.
2. **Batch to do after the atoms branch lands** (conflicts otherwise, same pages):
   - 3.4 board progress by pieces: the board rows now carry `currentStageQty`, `currentStageProduced`, `currentStageMadeIsEstimate` (see `md/api.md`, DEC-028). Words when nothing reported, estimate labelled, bar capped at 100% but the number shown, bar neutral.
   - 4.1 undo for "Don't show": `POST /api/warnings/:id/undo-dismiss` (409 `needs_confirmation` for a confirmed one: no undo for those). In-page InlineUndo, no timer, focus kept (`review.test.ts` 96 to 110).
   - AUDIT-03 S2: the Update hero overflows in Tamil at 200% zoom (195 px wide): fix and add a check that `npm run ux` can see (it only measures page overflow).
   - Cheap S3s from AUDIT-03: PO links 23 px tall on the desktop board, buyer Download 40 px on a phone, the two board toolbars, a skip link, Setup tab wrapping, page width jumps between Setup tabs.
3. **Release:** tag `build-1008` on the final commit (the record is `docs/builds/build-1008.md`; if HEAD's title equals the report title use `node scripts/changelog.mjs --tag`, otherwise `git tag build-1008 <commit>`), then `git push origin frontend-audit build-1008`.
4. **Pictures:** retake `uiux/2.0` with `npm run snapshots` once the UI has settled (1.0 stays frozen; nothing is ever deleted).

## Open points for the user
- Tag numbering clash: my tags InBul17 and InBul18 (pushed) share numbers with the backend session's commit titles "InBul17: Board rows carry the pieces..." and "InBul18: Give the slowest fuzz test room". No tag was moved. Decision pending: leave as is and take the next numbers from the tags on the remote.
- Should form errors stay ink (not red)? Chosen by the theme sweep because red means order status only.
- Should the merchandiser's tab row scroll away on a phone (sticky bar is 125 px)? Should the supervisor's number field stay autofocused with the keyboard up?
- The mock-up branch `ui2-mockups` (three directions, published as a private page) is not merged and not needed unless the user wants to compare again.

## Not verified anywhere
A real phone in daylight with the new theme, an iPhone, a low-end phone, a screen reader, the Stop/Allow/Reset entries in Activity, supervisors reading the draft Tamil (`audit/TAMIL-REVIEW.md`).

## Servers and cleanup
Dev API (8787) and Vite (5173) were started from the main checkout and may be stopped. `scripts/zz_api.ts` is an untracked scratch file from an earlier session: leave it. Remove the finished worktrees when no longer needed (`git worktree remove`; the branches stay).
