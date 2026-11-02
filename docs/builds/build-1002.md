# Build 1002: Set up an order and see exactly why it has its colour

Date: 2026-11-03
Tag: build-1002

<!-- manual:start -->
## What changed

Merchandisers can create an order from a form and see, before creating it, the date each stage must finish, worked backwards from the ex-factory date. Opening an order from the board shows each stage with the planned finish date beside the date it will really finish at the current rate, how far apart they are, the progress and the working behind the colour. The ex-factory date can be changed there; a reason is required and every change is kept in a history showing who, when, what and why.

## Why

Merchandisers could see problems on the board but could not create an order or understand one without asking someone. This closes that gap and keeps every date change accountable.

## How it was checked

Driven in Microsoft Edge against the real API: an empty form lists every missing field, the preview shows the right dates, an order that is already late is flagged but allowed, creating an order opens its detail page, changing the date records the history, and neither page scrolls sideways on a phone. Using the form found and fixed a real flaw (a size left blank was treated as an error). 237 automated tests pass. Not re-run after this change: the offline supervisor browser test. Not checked: a real merchandiser using it, or creating an order from a template with stages in different units.

## Next improvement

A review queue so a merchandiser confirms warnings and photos before any buyer sees them, then the buyer view.
<!-- manual:end -->

## Files changed

- README.md
- packages/server/src/app.ts
- packages/server/src/boardService.ts
- packages/server/src/engineData.ts
- packages/server/src/index.ts
- packages/server/src/orderDetailService.ts
- packages/server/src/orderService.ts
- packages/server/test/detail.test.ts
- packages/web/src/App.tsx
- packages/web/src/orders/orderForm.ts
- packages/web/src/pages/Board.tsx
- packages/web/src/pages/OrderDetail.tsx
- packages/web/src/pages/OrderSetup.tsx
- packages/web/src/styles.css
- packages/web/test/orderForm.test.ts
- scripts/snapshots.ts
- uiux/03-board-desktop.png
- uiux/04-board-filtered-red.png
- uiux/05-board-menu-open.png
- uiux/06-board-greyscale.png
- uiux/07-board-tamil.png
- uiux/09-board-phone.png
- uiux/16-today-offline-waiting-phone.png
- uiux/17-order-form-empty.png
- uiux/18-order-form-errors.png
- uiux/19-order-form-preview.png
- uiux/20-order-form-late.png
- uiux/21-order-detail.png
- uiux/22-order-detail-phone.png
- uiux/23-order-form-phone.png
- uiux/README.md
