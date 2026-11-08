# ui: the component library (Atomic Design)

Plan: `audit/POA-UIUX.md`. New and rewritten components go in these four folders. The older files directly in `ui/` (AppBar, StatusBadge, SyncChip, the dialogs and so on) move in one mechanical change in phase 6, so history stays readable until then.

| Folder | What belongs here | Examples |
| --- | --- | --- |
| `atoms/` | One element with variants and states; no knowledge of orders, buyers or the API | Built: DateWords, PieceBar, ProgressRing, Skeleton. Still to come (phase 2): Button, TextLink, Input, Select, Textarea, Chip, Icon, Text |
| `molecules/` | A few atoms doing one job | Built: ActionBar, NavTabs. Still to come: Field (label, input, hint, error), SegmentedControl, Banner, EmptyState, InlineUndo, BackLink |
| `organisms/` | A section of a screen made of molecules; may take data as props | Built: AccountActivity, AddPersonForm, KeyFacts, OrderBento, SetupChecklist, StageCard, StatusTiles, TodayHero, UpdateHero. Still to come: FilterStrip, ReviewCard, PeopleTable, UpdateForm |
| `templates/` | A page frame with slots and no content of its own | SupervisorShell, MerchandiserShell, AuthShell, PublicShell |

Pages (`src/pages`) fetch data, hold the state and place organisms inside a template. They write no layout of their own.

## What exists (8 Nov 2026)

Each line gives the states the component draws; every state has a test. All receive their data and words as props (rule 8) unless noted.

| Component | Where | What it is, and its states |
| --- | --- | --- |
| `ActionBar` | molecule | A form's one primary action pinned to the bottom, with the "saved" line, a failure line and the question about the number above the button, and a slot that hosts the "new version ready" bar (`bottomSlot.ts`). Used on the supervisor's Update screen. No transform, animation or overflow on it or an ancestor. |
| `NavTabs` | molecule | Board, Review and Setup as tabs in the merchandiser's app bar: real links; the current place has `aria-current` and an underline and heavier weight, not only colour; the Review tab shows how many wait (hidden when 0 or unknown, "99+" above 99, with the number also spoken). |
| `DateWords` | atom | A date in words under a date field ("Thursday, 12 Nov 2026"). Empty or not a real day (a half-typed date, 31 Feb): nothing is drawn. Hidden from screen readers (the field announces its own value). |
| `Skeleton` | atom | A neutral grey block standing where content will be. States: waiting (a slow pulse), reduced motion (still). Used only where a wait was measured over 1 s: Today's list after sign-in, held back 180 ms. |
| `ProgressRing` | atom | A ring filled to a fraction with something short in the middle. States: empty, partly, full; a wrong number (NaN, over 1) is clamped. Decorative; the sentence beside it says the same. The fill grows once on arrival, not under reduced motion. |
| `PieceBar` | atom | Pieces done against planned as a bar on grey. It says how far, never how well. Over the plan it stops at full while the numbers beside it keep the real count. Decorative. |
| `KeyFacts` | organism | The few numbers an order page opens with, as tiles in a description list (a screen reader hears "Quantity, 4,550"). States: no facts (nothing drawn), a fact with or without a hint. Never coloured. |
| `OrderBento` | organism | The order page as a grid of rounded cells: on a wide screen the timeline and stage cards sit side by side, then the two action cards, then history and notes; on a phone one column in the same order. DOM order is reading order; an empty area is left out. It lays out only. |
| `StatusTiles` | organism | The board's status filter as large tiles on wide screens (a phone keeps compact chips): each tile is a toggle button (`aria-pressed`) with the status icon, the word and a count that equals what clicking it shows; the All tile has no status mark. States: pressed (heavy ink ring), not pressed, hover, keyboard focus. Surfaces are plain white. |
| `StageCard` | organism | One stage on the supervisor's Today list: order and stage large, pieces done against planned with a bar, a tick on today's count once something was entered, one full-width Update button. States: nothing entered today, entered today, over the plan. `li.stage` and `a.stage__go` are hooks for the e2e checks and the focus code. |
| `TodayHero` | organism | The top of Today: a ring, "N of M updated today", the date the counts go to, and the sync chip, on the soft wash. The words arrive already in the supervisor's language. |
| `UpdateHero` | organism | The top of Update: which order (the page's `<h1>`), a ring with the share, and "today so far" and "left" in big figures, on the soft wash. |
| `SetupChecklist` | organism | The pilot checklist on Setup: Units, Closed days, Templates, People. States: loading; failed to load (the shared card with Retry); nothing set up; partly (open, with what is left in a line); all done (one line, list folded). An item that could not be read says "Not checked", never guessed. |
| `AddPersonForm` | organism | One form for adding a person with a Supervisor or Merchandiser choice that decides the fields; keeps the name when the role is switched; checks what it can before sending; the one filled button on People. A unit is not a person: "Add a unit" stays separate. |
| `AccountActivity` | organism | Who stopped, allowed, reset or added an account, and when. States: loading; could not load (shared card with Retry); nothing yet; a list (latest ten, the rest behind a button). The sentence is the server's own plain English. |

Pure helpers beside them (`navRules.ts`, `bottomSlot.ts`, `syncNotice.ts`, `../numberFormat.ts`, `../dateWords.ts`, `../stages/pieceProgress.ts`) hold the rules and have tests. The older files directly in `ui/` (AppBar, StatusBadge, SyncChip, StageTimeline, the dialogs) have not moved yet.

## Rules for every component
1. **State table first.** Before an atom or molecule is built, write its states (empty, typing, valid, invalid, disabled, offline, saving, waiting, sent, failed, as they apply). Every state gets a test.
2. **Tokens only.** Colour, spacing, radius, elevation and tap size come from `packages/design/tokens.css`. No hex values, no one-off pixel numbers for those. After a token change run `node scripts/check_contrast.mjs`.
3. **Status is an icon, a word and a colour**, drawn only by `StatusBadge`, always as the ruled stamp (`ui/StatusStamp.css`: at least 79 x 24 px, capitals, double rule, level, no fill). Red, amber and green mean order status and nothing else, and only on the icon, the word and the stamp: never a card, tile or row background (`test/noStatusTints.test.ts`). Sync, disabled, "failed to load" and a form error are neutral (a form error is ink with a drawn "!" mark).
4. **Touch:** at least `--tap-min` (44 px with a mouse, 48 px on a phone); Send and number fields on supervisor screens `--tap-primary` (56 px), which a later `pointer: coarse` rule must never lower.
5. **Words** come from `i18n.ts`. A key a supervisor can see needs Tamil (a test enforces it); new Tamil is drafted and marked unreviewed until supervisors correct it.
6. **Built inside a real page:** look at it at 390 px with touch emulation and at 1280 px, in English and Tamil, with a long Tamil label and a long buyer name, before calling it done.
7. **No new dependency** without asking.

## More rules (from the guides of your other projects, checked against this app)
8. **Who may fetch.** Atoms, molecules and organisms receive data as props and never call `apiFetch` or touch storage. Pages and hooks fetch; `lib` and the pure `*Logic.ts` files hold the rules and have tests (ORCA layers table).
9. **A stylesheet beside the component** for new atoms and molecules (`Button.tsx` and `Button.css`), tokens only; `styles.css` keeps the base and the older rules. `packages/web/test/designGuards.test.ts` scans every `.css` and `.tsx` for a literal colour.
10. **Sticky and fixed need clean ancestors.** No `transform`, `animation` with a transform fill, `filter`, `backdrop-filter` or `overflow` on an ancestor of a `position: sticky` or fixed child: a transform makes that ancestor the containing block, and an `overflow` stops sticky working (ORCA top bar, TARANG 14.E). Check in a browser that it really sticks.
11. **One bottom region per screen.** Anything else that wants the bottom of the screen draws itself into the ActionBar's slot (`ui/bottomSlot.ts`), not on top of it.
12. **A specificity check for every size token.** A later `@media (pointer: coarse)` rule can beat a base rule with the same specificity (this is how Send lost its 56 px). When a rule sets a size a token owns, give it two classes or check it on a touch emulation (`npm run ux`).
