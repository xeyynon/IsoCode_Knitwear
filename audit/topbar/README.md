# Top bar as three shapes

Branch `topbar`. Built from the ORCA top bar guide, adapted to this app. Nothing here is pushed.

## What changed

The one strip across the top is now three shapes on the page, in a grid of `1fr auto 1fr` so the middle one stays centred whatever the sides hold.

| Shape | Merchandiser | Supervisor | Public page (status, buyer link) |
| --- | --- | --- | --- |
| Left capsule, flush with the left edge | App mark and name, link to the Board | App mark (name too on wider screens), link to Today | App mark and name, link to the start page |
| Centre tab, hanging from the top edge | Board, Review (with the waiting count), Setup | The page title | none |
| Right capsule, flush with the right edge | One menu | One menu | none |

- One shared menu (`PopoverMenu`) for both roles: focus enters on the first row, Up and Down move and wrap, Home and End jump, Esc closes it and gives the focus back (one press, one step), Tab closes it, a click outside closes it. The move logic is a small pure function, `nextMenuIndex`, with its own test. Every existing menu item is kept.
- Exactly one h1 per page. A supervisor's centre tab is the h1; a merchandiser's views already say where they are, so the h1 is visually hidden. Pages that show their own heading (New order, Page not found, the public pages) have no second one.
- The entrance (260 ms, transform and opacity only, `fill-mode: backwards`) plays once per visit, on the first bar, and is off under reduced motion. Before, the bar was rebuilt on every page and a replay on each navigation would read as a wiggle.
- Tokens only, light and dark. Two non-colour tokens were added: `--radius-xl` and `--radius-pill`.
- Below 1100 px the merchandiser's views become a full-width band under the capsules that scrolls sideways. The supervisor's bar survives Tamil and 195 px (the title takes a band of its own and may wrap).

## Where this differs from the guide, and why

- No search icon and no notification badge. The app has no global search and no notifications; a dead control is worse than none.
- No elevation shadow. The app uses hairline borders, not shadows. The shapes share one `--border` hairline and one `--surface`.
- A supervisor's centre tab is the page title, not a set of views: a supervisor has one flow and nothing to switch between.
- Public pages get the brand capsule only. A visitor is offered no internal screen and no control.
- The sign-in page has no bar (unchanged: there is nothing to navigate to yet).
- The old `.menu*` classes stay in `styles.css`; `PopoverMenu` uses them.

## Measured (`npm run ux`, which now also runs `scripts/topbar_metrics.ts`)

- Centre tab off the screen centre: 0 px at 1180, 1280, 1366, 1440 and 1920 px (merchandiser), and for a supervisor at 1280 and 390 px.
- Brand, views and menu button share one centreline (28 / 27.5 / 28 px). Side capsules flush with the edges (0 px / 0 px). Bar height 56 px. One h1.
- Phone: no sideways overflow at 390, 320 and 195 px; tap size 48 px for the menu button and the views on a touch device. `npm run ux`: 55 of 55 screen-widths clean.
- Phone board, merchandiser: bar 121 px (was about 125), first card top at 403 of 870 px.
- Update screen in Tamil, keyboard open: the number field top is at 355 of 844 px (was 364 with the old 65 px bar); Send ends at 832 of 844 px.
- Menu in a real browser: focus lands on the first row, ArrowDown wraps, Esc returns focus to the button. Entrance: the first bar slides in; after a page change none is running.
- `npm run a11y`: 48 screens, no serious or critical violations, light and dark. `npm run e2e`: 23 of 23 under the Content-Security-Policy.

## Tests

New: `menuRules`, `popoverMenu`, `topBar`, `topBarCss`. Rewritten to keep the same promise: `finalF4Buyer`, `narrowScreens`, `navRules`, `darkTheme`, `templates`, `skipLinkNotFound`. Mutation checks (each failed the right tests, then restored): removing the entrance mark, an off-centre grid, removing the Esc focus restore.

## Pictures

`before-*` and `after-*` pairs: merchandiser at 1366 (board, board dark, order, review, setup, new order, menu open), merchandiser phone 390 (board, review), supervisor in Tamil at 390 (today, today dark, update, menu open) and 195, and the public status page.

## Not verified

A real phone, an iPhone, a screen reader. The pictures are from a desktop browser with touch emulation.
