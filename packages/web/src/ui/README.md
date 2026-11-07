# ui: the component library (Atomic Design)

Plan: `audit/POA-UIUX.md`. New and rewritten components go in these four folders. The older files directly in `ui/` (AppBar, StatusBadge, SyncChip, the dialogs and so on) move in one mechanical change in phase 6, so history stays readable until then.

| Folder | What belongs here | Examples |
| --- | --- | --- |
| `atoms/` | One element with variants and states; no knowledge of orders, buyers or the API | Button, TextLink, Input, Select, Textarea, Chip, Icon, Text, Skeleton |
| `molecules/` | A few atoms doing one job | Field (label, input, hint, error), ActionBar, SegmentedControl, Stat, ProgressBar, Banner, EmptyState, InlineUndo, BackLink |
| `organisms/` | A section of a screen made of molecules; may take data as props | FilterStrip, BoardCard, StageCard, KeyFacts, ReviewCard, PeopleTable, UpdateForm |
| `templates/` | A page frame with slots and no content of its own | SupervisorShell, MerchandiserShell, AuthShell, PublicShell |

Pages (`src/pages`) fetch data, hold the state and place organisms inside a template. They write no layout of their own.

## Rules for every component
1. **State table first.** Before an atom or molecule is built, write its states (empty, typing, valid, invalid, disabled, offline, saving, waiting, sent, failed, as they apply). Every state gets a test.
2. **Tokens only.** Colour, spacing, radius, elevation and tap size come from `packages/design/tokens.css`. No hex values, no one-off pixel numbers for those. After a token change run `node scripts/check_contrast.mjs`.
3. **Status is an icon, a word and a colour**, drawn only by `StatusBadge`. Red, amber and green mean order status and nothing else; sync, disabled and "failed to load" are neutral.
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
