# For the backend session: pieces of the current stage on the board (UI/UX plan, slice 3.4)

From the UI session, 8 Nov 2026. This is a request, not a change: nothing under `packages/server` or `packages/engine` was touched from here.

## Why
Audit 02 finding 4. The board's progress bar counts finished stages ("0/1 done"), so for an order with one stage it is empty for every order, even one with 1,750 of 4,550 pieces made. The order page already shows the real number. The UI wants to show "Sewing: 1,750 of 4,550 pieces" and fill the bar by pieces.

## What the board row has today (`boardService.ts`, around lines 25 to 35)
`stagesDone`, `stagesTotal`, `currentStage` (the first stage not finished, or null), `lowConfidenceStages`.

## What the UI needs added to each board row (null when there is no current stage)
- `currentStageQty`: the pieces the current stage should make (the same `qty` the order page's stage detail shows).
- `currentStageProduced`: pieces made so far in that stage (the same `produced`).
- `currentStageMadeIsEstimate`: whether the rate behind the stage is an estimate (fewer than 3 days of updates), the same flag the order page has as `madeIsEstimate`.

The numbers must come from the same place as the order page's stage detail, so a board row and its order page can never disagree. Not requested: percentages (the UI works them out and caps the bar at 100% while still showing a number over 100).

## How the UI will use it, and what it will not invent
- No update reported yet: words, not "0 / 4,550".
- An estimate or a low-confidence stage (a merchandiser's visit entry) is labelled as such, as on the order page.
- Produced over the quantity: the number is shown as it is; only the bar stops at full.
- The bar stays neutral (not a status colour): status is the badge's job.

## Buyer link
These fields are for the merchandiser board only. The buyer view must not gain them (a buyer sees no quantities by stage today; confirm before exposing anything).

## Tests I will add on the UI side once the field exists
Words when nothing is reported; estimate label; over 100%; the bar's width capped; greyscale check.
