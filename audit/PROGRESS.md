# UI/UX 2.0 progress log

One entry per slice: what changed, measured before and after, what was not checked. Plan: `audit/POA-UIUX.md`. Decisions D1 to D4 were taken on 8 Nov 2026 (draft Tamil for new words, 48 px touch targets, a component test harness, start with phase 0).

## 0.1 Demo clock trap and the baseline script (8 Nov 2026)

**Changed**
- `scripts/snapshots.ts`: every browser context now starts its clock at the demo API's "now" (from `/api/status`) and lets time run on. Before this, the merchandiser shots could not sign in on any real date after 4 Nov 2026.
- `scripts/ux_metrics.ts` and `npm run ux`: measures the plan's baseline numbers with touch emulation (Send in view, Send height, first order card on a phone, broken words in the People table, hand-written markup, media queries).
- `frontendskill.md` section 3: the trap and the fix are written down.

**Measured**
- Without the clock, merchandiser sign-in is refused ("This device's date or time looks wrong"); with it, the board loads (checked in Edge, both ways).
- Baseline (see the table in `POA-UIUX.md` section 3), including a **new finding**: Send is 44 px high on touch, not 56 px.

**Checks run:** `npm run typecheck` clean; `npm run snapshots` run end to end (31 pictures written to `uiux/2.0`).

**Not checked:** a real phone.

## Snapshots: nothing is deleted, 1.0 and 2.0 (8 Nov 2026)

You asked for every snapshot to be kept, with the old set named 1.0 and the new one 2.0, and no duplicate copy in the same folder.

**Changed**
- The 31 pictures and index that were in `uiux/` are now **`uiux/1.0/`** (moved, after checking every file is byte-identical to the original; one line was added to its index saying it is a frozen record). `uiux/README.md` is now an index of both sets.
- `scripts/snapshots.ts` writes to **`uiux/2.0/`** only and never touches 1.0. It used to delete every `.png` in `uiux/` before writing; now, if a 2.0 set already exists, it is first kept in `uiux/2.0/previous/<date-time>/` (index included) and only then replaced.
- The script's menu selector no longer depends on the page language (`button[aria-haspopup=menu]`): the working tree translates the menu label, which stopped the run in Tamil. It failed before writing anything, so no pictures were lost.
- `README.md` and `frontendskill.md` describe the new layout.
- The audit screenshots in `audit/` and the Playwright files in `.playwright-mcp/` are untouched and stay.

**Note for git:** the old paths show as deleted and `uiux/1.0` as new until staged (a move); nothing was committed.

## 0.2 Tokens and the 48 px touch size (8 Nov 2026)

**Changed** (decisions D2 and the plan's slice 0.2)
- `packages/design/tokens.css`: spacing scale (4 to 32), radius scale (6, 8, 10), elevation tokens (menu, dialog, bottom bar), disabled colours (`--disabled-bg`, `--disabled-ink`, not the status grey), and `--tap-min` is 44 px with a mouse and **48 px on a coarse pointer**.
- `packages/web/src/styles.css`: `.input`, `.seg__btn` and `.menu__item` took a fixed 44 px; they now read `--tap-min`. The menu and dialog shadows read the elevation tokens (same values).
- `scripts/check_contrast.mjs`: the disabled pair is checked (4.87:1; needs 4.5).
- `packages/web/test/tapTargets.test.ts`: new tests that the token is 44 and 48 and that the three controls use it. They **failed on the old code** (4 failures) and pass now.

**Measured in Edge:** with a mouse the token is 44 px (input 44, tabs 44); with touch emulation it is 48 px (input 48, tabs 48).

**Found while checking (not fixed here):** on touch, the sign-in button measures **48 px, not 56 px**, so the same override that lowered Send to 44 px hits every `.btn--block` primary (slice 1.0).

**Not checked:** a real phone; the disabled colours are not used by any rule yet (slice 1.4).

**Lane note:** `md/poa_backend.md` shows a separate backend session owns `packages/engine`, `packages/server`, the release scripts and CI. I only touched `scripts/snapshots.ts`, `scripts/ux_metrics.ts`, `scripts/check_contrast.mjs` (design-token tooling) and the `ux` line in `package.json`.

## 0.3, 0.4, 0.5 Folders, component test harness, state tables (8 Nov 2026)

**Changed**
- `packages/web/src/ui/atoms|molecules|organisms|templates/` created, with `ui/README.md`: what belongs in each level and seven rules for every component (state table first, tokens only, status icon + word + colour, tap sizes, words and Tamil, built inside a real page, no new dependency).
- Component test harness (decision D3): dev-only `jsdom@25`, `@testing-library/react@16`, `@testing-library/dom@10`; `vitest.config.ts` now also runs `*.test.tsx` (each asks for jsdom in its first line, so the Node tests are unchanged); `tsconfig.json` type-checks `*.test.tsx`. `npm audit` lists 6 issues, all in vitest, esbuild and tinypool (the existing test tooling), none in the three added packages; dev-only.
- First component test: `packages/web/test/statusBadge.test.tsx` (6 tests): icon and word together, four different shapes, grey is never the green check. **Broken on purpose** (grey drawn as the green check): 2 tests failed; restored.
- `audit/STATE-TABLES.md`: states for the quantity field, the ActionBar and Send, the sync chip (texts checked against `i18n.ts`), Button and Field.

## 1.0 Send keeps 56 px on a phone (8 Nov 2026)

**Found by** `npm run ux` with touch emulation (slice 0.1): Send was 44 px high on touch, the sign-in button 48 px, instead of 56 (rule 13). The coarse-pointer `.btn` rule has one class, comes later in `styles.css` and has the same specificity as the bare `.btn--block` rule, so it won.

**Changed:** `.btn--block` is now `.btn.btn--block` (two classes beat one), with a comment saying why. `tapTargets.test.ts` gained two tests; both **failed on the old CSS** and pass now.

**Measured (touch emulation, Edge):** Send 56 px in English and Tamil (was 44 and 46). Update is 1078 px tall in English (Send's bottom edge at 1041 of 844: still below the fold, which slice 1.1 fixes).

**Side effect of the 48 px token (D2), recorded honestly:** every touch target is 4 px taller, so the phone board's first order card now starts at 623 px of 844 (74%), up from 583 (69%). Slice 3.2 (phone filters) matters more.

**Checks run:** `npm run typecheck`, `tapTargets` and `statusBadge` tests, contrast gate; full `npm run verify` was green after 0.1 and 0.2 (1282 passed, 16 skipped) and is rerun at the end of phase 1.

**Not checked:** a real phone; `npm run a11y` and `npm run e2e` (no supervisor-flow markup changed yet).

## Your other projects' guides folded into the plan (8 Nov 2026)

TARANG, ORCA (top bar and frontend), Dukaan Dost (guide and skills) and Calley were read and checked against this code; see `POA-UIUX.md` section 8b. New slices from them: 0.6 to 0.9, 1.9, 1.10, 3.3 (rewritten), 3.10, 4.5, 5.3; new decision D5 (merchandiser navigation in the app bar, **open**); commit hygiene and DEC numbering added to the definition of done. Declined with reasons: screen-change cover, themes, glass, Flutter and composer specifics.

## 0.6 and 0.7 No literal colours; light only (8 Nov 2026)

**Changed**
- `tokens.css`: `--on-accent`, `--on-ink`, `--border-soft`, `--scrim`, `--scrim-strong` and `color-scheme: light`.
- `styles.css`: the ten literal colours (five `#fff`, three dividers, two scrims) now read tokens; `StatusBadge.tsx`'s "!" reads `--on-accent` through a style (an attribute cannot hold `var()`); `index.html` declares `<meta name="color-scheme" content="light">`.
- `check_contrast.mjs`: three new pairs (on-accent on accent 8.13:1, on-ink on ink 15.80:1, the "!" on red 5.10:1).
- `packages/web/test/designGuards.test.ts`: fails on any hex or functional colour in any `.css` or `.tsx` under `src` (tokens excepted), and checks the colour scheme and the tokens exist. **9 failures on the old code**, none now.

**Measured in Edge:** sign-in text white on indigo, selected chip white on ink, the red "!" white, row dividers `rgba(140,149,159,.35)`, `color-scheme: light`: all as before, so no picture should change.

## 1.1 The Send bar (8 Nov 2026)

**Changed**
- New molecule `ui/molecules/ActionBar.tsx` (+ `.css`, first component with its own stylesheet): pinned to the bottom of the screen (`position: sticky`, `bottom: 0`, safe-area padding, upward shadow token), inside the card and the form. On Update it holds, in reading order, the failure line, "Saved ... Sent." (so it stays in view after a send), the "more than is left" question and Send.
- `ui/bottomSlot.ts` + `UpdateBanner.tsx`: the "new version is ready" bar draws itself into the ActionBar's slot (a portal) when a bar exists, so the two never overlap. Before this they would have, because that bar appears exactly when a send clears the form.
- `index.html`: viewport gains `interactive-widget=resizes-content` (Android Chrome 108+ then shrinks the page for the keyboard, so the bar sits above it); pinch-zoom stays allowed. `.card` exposes `--card-pad`. The bar leaves `scroll-padding-bottom` so a focused field is not left under it.
- Tests: `actionBar.test.tsx` (3, jsdom) and `actionBarGuards.test.ts` (10). **Broken on purpose** (`position: sticky` removed): the guard failed; restored.

**Measured (touch emulation, Edge, 390x844):** Send's bottom edge **832 of 844 px in English and Tamil** (was 1041 and 1144, below the fold); Send 56 px high; in view at the top of the page, scrolled and with the number typed. Saved offline with a new version offered: the update bar is inside the bar, no overlap, everything in view (bar 228 px high in English, 263 in Tamil). `npm run a11y`: **0 failures on 48 screens**. `npm run e2e`: **22 of 22** on a production build.

**Also:** `scripts/e2e_offline.ts` reads `E2E_API_PORT` (default 8787) so it can run beside a dev API another session is using.

**Not checked:** a real phone (on-screen keyboard behaviour, `interactive-widget`, an iPhone, where Safari ignores it); a bar that is 228 to 263 px high is heavy with the keyboard open, but only appears when a new version is waiting. The pale disabled Send is slice 1.4. The Tamil strings are unchanged (no new words).

## 1.2 to 1.7 The supervisor's sign-in and Update screens (8 Nov 2026)

**Changed**
- **1.2 Sign-in opens on the right form.** New pure rules `src/loginRules.ts`: the form opens on the role last signed in on this phone; with none remembered, a Tamil phone opens the supervisor form and an English one the merchandiser form. The role is written **only after a sign-in that worked** (a wrong PIN changes nothing), through try/catch storage. On a touch screen the cursor is held back until the role is known, so the keyboard no longer opens over the role switch. The tab order is unchanged (merchandiser first), so scripts that click "the second tab" still mean supervisor.
- **1.3 The language switch is a visible pair**, தமிழ் and English side by side (`.seg--lang`), each marked with its own `lang` and pressed state, 48 px high on touch. It uses the existing `nav.toTamil` and `nav.toEnglish` names (the same in both languages), so **no new Tamil**.
- **1.4 A clear disabled look** for every `.btn:disabled`: `--disabled-bg` with `--disabled-ink` (4.87:1), a visible border, a not-allowed cursor; the 55% opacity is gone. (Not `--status-grey`.)
- **1.5 The number field points at the "more than is left" question**: `aria-describedby="hint toomany"` while it is open and a 2 px **ink** edge (`.input--asking`). Not `aria-invalid` (more than left is allowed) and not red (red means order status).
- **1.6 The focus bug**: the number field took focus on `[queue]`, before it existed, so nothing had focus on arrival. It now waits for the stage (`hasStage`).
- **1.7 Sign-in phone and PIN fields are 56 px** (`.input.input--tall`, two classes); the note box has no resize grip on a touch screen.
- Tests: `loginRules.test.ts` (12), `supervisorPolish.test.ts` (12, source guards). **Each failed on the old code first** (login: module missing; polish: 10 of 12 failed).

**Measured (Edge, touch emulation, 390x844)**
- Fresh English phone: merchandiser form, nothing focused. Fresh Tamil phone: supervisor form (tel and password fields), nothing focused. After a supervisor signs in and out: supervisor form, cursor in the phone field, `orders.lastRole = supervisor`.
- Sign-in fields 56 px (were 44/48). Disabled Send: `rgb(228,230,234)` on `rgb(91,99,109)`. Number field focused on arrival: yes (was no). Note box `resize: none`. Question state: described by `hint toomany`, border `rgb(31,35,40)` 2 px, button "Send 99999 anyway".
- Language pair: both buttons 48 px high, 151 and 163 px wide; choosing தமிழ் changes the page to Tamil (`html lang="ta"`, heading "உள்நுழை"); no sideways overflow.

**Not checked:** a real phone (keyboard behaviour, the cursor held back, autofill); a wrong PIN against the live demo (it would count towards the account lockout; the unit and source tests cover it); whether a person choosing Tamil on a phone with nothing remembered should also be moved to the supervisor form (an idea, not built: a Tamil-preferring merchandiser would be surprised). Still open in this phase: 1.8 (Today's context line), 1.9 (Next stage) and 1.10 (N of M updated), which add words and so need draft Tamil.

**Checks for 1.2 to 1.7 (end of the supervisor phase):** `npm run verify` green (72 test files, 1366 tests passed, 16 skipped; repo, docs and contrast checks pass); `npm run a11y` 0 serious or critical on 48 screens; `E2E_API_PORT=8799 npm run e2e` 22 of 22; typecheck clean.

## The real phone: keyboard test (8 Nov 2026)

**Device:** Samsung Galaxy S23 Ultra (SM-S918B), Chrome 156, USB debugging, the app served from this computer through `adb reverse` (phone `localhost:5174`). CSS viewport 384 px wide, pixel ratio 2.8125, `pointer: coarse` true. Real taps and typing through Android; nothing was sent to the server (the one Send press was with 99999, which only asks the question).
**Note on the setup:** Vite's dev server listened on IPv6 only, so the first attempt showed `ERR_EMPTY_RESPONSE`; a second instance on `127.0.0.1:5174` fixed it (steps are at the top of `scripts/phone_keyboard.ts`, `npm run phone`). A flagship phone says nothing about speed on a 2 GB phone.

**Measured**
- **`interactive-widget=resizes-content` works:** with the numeric keyboard open the page height goes from 719 to 367 CSS px, so the layout shrinks for the keyboard.
- **Update, keyboard open:** the Send bar's bottom edge is at 367 (the top of the keyboard), Send is 56 px (355 bottom), and the number field (156 to 212) is on screen with it. The number field **had the cursor and the keyboard up on arrival** (slice 1.6 working on a real phone).
- **Sign-in:** a fresh phone opens the merchandiser form with no keyboard (slice 1.2); tapping the phone field raised it. The language pair, the grey disabled button and 56 px fields render as designed.
- **"More than is left" question** (keyboard closes because Send takes focus): the number field is outlined in ink, the Tamil question box and the button fit; the button label **wraps to two lines** in Tamil ("இருந்தாலும் 99999 அனுப்பு", 77 px high), which is allowed; the bar is 245 of 719 CSS px.
- Gboard's numeric keypad on this phone also offers `-`, `,` and `.`; a typed "-5" is still refused in words, as before.

**Not checked:** an iPhone (Safari ignores `interactive-widget`); a low-end phone; Samsung Internet; the TalkBack screen reader; autofill and the cursor-held-back behaviour on a first-ever sign-in beyond the one phone state tried. The phone's Chrome still has a tab on this app signed in as the demo supervisor.

## 3.3 The merchandiser's navigation in the app bar (D5: yes), 8 Nov 2026

**What was borrowed from the ORCA top bar, and what was not:** primary places as tabs in the bar with the current one marked by an underline, the number that needs attention on a tab, the shortcut in each tooltip, a real link per tab. Not copied: the three floating capsules or the icon set (our bar is already calm and works on a phone).

**Changed**
- New molecule `ui/molecules/NavTabs.tsx` (+ `.css`): **Board, Review, Setup** as links in the app bar for a **merchandiser only** (a supervisor has one flow, a buyer none). The current place carries `aria-current="page"`, bold weight, an underline and the action colour (not colour alone); orders belong to Board. Tooltips name the shortcut that already exists ("Review (G then R)"). 44 px on a mouse, 48 px on a phone.
- **The Review tab shows how many wait**, on every merchandiser screen (before, only the board knew). `ui/useReviewCount.ts` asks when a screen opens, on route change, on window focus, once a minute while visible and when the Review page reports a change (`notifyReviewChanged`). It stays silent on failure and never disturbs a screen. Nothing waiting or not known yet shows no number (never a placeholder zero); more than 99 shows "99+".
- Pure rules in `ui/navRules.ts` (`NAV`, `activeNav`, `badgeText`, `reviewCountFrom`, `showNav`).
- **Removed:** the Setup and "N waiting for review" buttons from the board toolbar (and the board's own `/api/review` call); the "← Back to board" and "← Order board" links from Review and Setup, whose bar now has the Board tab. Order pages keep their one "← Order board" back link. That leaves one wording instead of three.
- **The app bar's real height is now measured** (`--appbar-h`, `ResizeObserver`): the sticky Review summary bar and its jump links assumed 56 px, but the bar is 61 px on desktop and 125 px on a phone with the tabs on a second row (and taller when a Tamil title wraps).
- **"New order" no longer looks like a link** (`a.btn`: no underline, label centred): audit 02 finding 3.
- Tests: `navRules.test.ts` (rules and source guards, 17), `navTabs.test.tsx` (6, jsdom with a router). **Failed first** (modules missing; the link-button guard failed on the old CSS).

**Measured (Edge; desktop 1280x900 and a touch phone 390x844, merchandiser demo)**
- Tabs on Board, Review, Setup and an order page, current place marked correctly on each; Review shows **2**; the board toolbar link list is only "New order"; tabs 44 px (desktop) and 48 px (phone); no sideways overflow.
- App bar 61 px high on desktop, **125 px on a phone** (two rows); `--appbar-h` equals it; the Review summary bar's top follows it (77 and 141 px).

**Costs and open points**
- On a phone the merchandiser's bar is **64 px taller** (a sticky 125 px of 844); a merchandiser mostly uses a desktop, but it is a real cost. An option is to let the tab row scroll away on a phone.
- The tabs have no icons (ORCA's had): three words scan fine.
- The demo's merchandiser sign-in cannot be done on the real phone because the demo clock is fixed (it would need a longer-lived demo token, a backend change, or a clock override that would also touch the phone's other tabs); so **the merchandiser screens were checked with touch emulation, not on the real phone**.
- Still to do in phase 3: the phone board's filters (3.2): the first order card is at about y 625 of 844.

## 3.2 The phone board's filters and a denser card (8 Nov 2026)

**Changed**
- New pure rules `board/filterPanel.ts` (`panelFilterCount`, `filtersButtonText`, `appliedFilters`) and a `useNarrow` hook (the board's own 720 px breakpoint).
- **On a phone** the status chips and the search stay in view; **buyer, sort, unit and ship week sit behind one "Filters (n)" button** (`aria-expanded`, closed to begin with). Each filter that is on shows as a **chip that removes it** ("Remove filter: Buyer: Buyer B"), so the list's narrowing is visible without opening the panel. A buyer or unit named by a shared link that no longer exists shows as "Unknown", never hidden. Refresh, "New order" and the updated time move to a row below the search. Every filter is still read from and written to the address.
- **The order card is a three-column grid:** status and the PO take the full width; Buyer, Ship and Gap share one row, label above value.
- **Wide screens are unchanged** (measured: no Filters button, the four selects inline, as before).
- Tests: `boardFilters.test.ts` (12: rules and source guards). Failed first (module missing).

**Measured (Edge, touch emulation, 390x844, merchandiser demo)**
- First order card: **407 of 844 px (48%), was 623 (74%)**; the card is 276 px (was 294); Buyer, Ship and Gap share one row (equal top).
- Open the panel: 4 selects, `aria-expanded=true`. Choose a buyer and close it: button "Filters (1)", chip "Remove filter: Buyer: Buyer B", address `?buyer=...`. Tapping the chip clears it and the address.
- `npm run verify` green (75 test files, 1400 tests passed, 16 skipped); `npm run a11y` 0 serious or critical on 48 screens.

**Against the plan's target:** the plan said "at most 338 px (40%)", set when the app bar was 61 px. With the tab row the phone bar is 125 px, so 407 is about 64 px of bar plus a little over. Two further savings exist and were not taken: let the tab row scroll away on a phone (decision pending), and put "Updated ..." beside the buttons (about 28 px).

**Not checked:** the real phone (merchandiser sign-in is blocked by the demo clock); the Filters button with a screen reader.

## 3.1 The People table keeps its words whole (8 Nov 2026)

**Cause (two things):** the shared small-table rule `.plan td { overflow-wrap: anywhere }` let any word break anywhere, and the actions cell was itself `display: flex`, which stops a cell being a table cell, so the column widths came out wrong.
**Changed:** the table's own rules (`.people td`, scoped so the buyer page and the other `.plan` tables are untouched): words stay whole; the role, state and unit cells never wrap; an email address may still break; the actions sit in a box inside an ordinary cell, in a fixed 220 px column on a wide screen so the buttons wrap inside it (not on a phone, where each row is a card); an account with no name reads "(no name)" instead of a dash. Tests: `peopleTable.test.ts` (8): **6 failed on the old code**, then 2 more for the width.
**Measured (Edge):** words broken in the middle at 1280 px: **"Merchandiser", "Active" and "m@example.test" (3) before, none now**; none at 390 px; no sideways overflow at 1280 or 1024. Columns 155/139/187/73/73/220 px.
**Checks:** web tests 611 passed; typecheck clean.
**Not checked:** the buyer page's and the other `.plan` tables after this change (the rule is scoped to `.people`, and `npm run a11y` covers them, but they were not compared picture by picture).

## 1.8 to 1.10 The supervisor's day: progress, the date, the next stage (8 Nov 2026)

**Changed**
- New pure rules `stages/dayProgress.ts` (`openStages`, `updatedToday`, `dayProgress`, `nextStage`). "An update" is pieces the server already holds for today **or** pieces saved on this phone and not yet sent. Nothing is invented; a finished stage is not counted; "0 of 0" is never shown.
- **Today** (1.10 and 1.8): one line under the sync chip, **"N of M updated today · Counts go to 4 Nov"**: how many of the day's stages have an update (the product's biggest risk is supervisors stopping), and the date the counts go to (the server's factory date, not the phone's).
- **Update** (1.9): after something has been saved, the **next open stage with no update today** appears as a button inside the bottom bar ("Next: B-PO-88290 · Sewing"), taking the list in its own order (soonest due first) and wrapping round. The screen is now **keyed by the stage it shows**, so moving to the next stage starts a fresh form: the previous stage's "Saved" line and typed number never carry over.
- **Words, with draft Tamil** (decision D1): `today.progress`, `today.countsFor`, `update.next`, each marked DRAFT in `i18n.ts` and listed with what to check in **`audit/TAMIL-REVIEW.md`** for the supervisors. The existing test that fails a supervisor key with no Tamil passes.
- Link buttons centre a label that wraps (`a.btn { text-align: center }`): the Tamil "Next" label wraps to two lines. Guard mutation-checked.
- **From the real phone:** Chrome offered "Translate page? Tamil to English" on the supervisor's Today screen (the phone's own language is English). Accepting would machine-translate our Tamil. `index.html` now carries `<meta name="google" content="notranslate">` (the app has its own language switch), with a guard that failed first.
- Tests: `dayProgress.test.ts` (16: rules, words, screens). Failed first (module missing).

**Measured (Edge, touch emulation; saved with the context offline, so nothing reached the demo server)**
- Today: "0 of 3 updated today · Counts go to 4 Nov" (English) and the Tamil draft.
- After saving 120 pieces on the first stage: the next-stage button "Next: B-PO-88290 · Sewing" (56 px high in English, 72 in Tamil), opening the second stage with an empty form, no "Saved" line and the cursor in the number field. Back on Today the count reads **"1 of 3"** (the update waiting on the phone counts).
- **Real phone** (Galaxy S23 Ultra): the Tamil progress line renders in two lines, no sideways overflow.

**Not checked:** the next-stage flow on the real phone (it would send a real update to the demo server); the Tamil wording with supervisors; whether three stages is typical (with only one stage the button never appears); the cost of "Next" for a supervisor who finishes in a different order.

## 0.9 The picture diff, and reproducible snapshots (8 Nov 2026)

**Why:** phase 2 (the atoms) is a refactor that must change nothing visible. "It looks the same" is not proof; this is.
**Changed**
- `scripts/pngDiff.ts`: reads 8-bit PNGs with Node's `zlib` (no dependency), compares two sets by name pixel by pixel (optional colour tolerance), reports the changed pixels, the box round them and any resize; `changesMarkdown` makes the report. `npm run diff` (`scripts/snapshot_diff.ts`) compares `uiux/2.0` with the newest set kept in `previous/` (or any two folders) and exits 1 if anything differs. It only reads.
- **`npm run snapshots` now compares what it just wrote with the set it kept and writes `uiux/2.0/CHANGES.md`** (a table of every picture that changed, how much, and where). Its browser clock is now **fixed** (`setFixedTime`), so the "Updated 10:00:01 AM" text is the same every run.
- `packages/web/test/pngDiff.test.ts` (7): round trip, identical, changed pixels and their box, tolerance, a changed size, one channel, transparency. Failed first (module missing).
- The first real run caught a bug in the wrapper's argument parsing (it compared 2.0 with itself); fixed.

**Measured**
- `uiux/1.0` against the early `uiux/2.0` set: 22 changed, 9 resized, 0 the same (as expected: build 1006 against the work so far).
- **Reproducible:** snapshots run twice with nothing changed in between: the first reported **28 of 31 pictures changed** since the early 2.0 set (phase 1 and 3, the tokens, the navigation), the second reported **no picture changed**. Both earlier sets are kept in `uiux/2.0/previous/` (nothing deleted).

**Not checked:** the tool on interlaced or 16-bit PNGs (it refuses them in words); a tolerance for the sub-pixel text differences between two different browsers (it is exact by default, which is what a refactor in one browser needs).

## 0.8 The touch-size and width audit, per screen (8 Nov 2026)

**Changed:** `npm run ux` now visits **every screen at five widths** (320, 360, 390, 768 with touch emulation; 1280 with a mouse): Sign in (merchandiser and supervisor), Status, Board, New order, Order detail, Review, Setup: People, Today, Update. It reports **sideways overflow** and **every control smaller than the tap size** (48 px on touch, WCAG's 24 px with a mouse; a link inside a sentence is exempt), by name and size.
**Measured now:** **50 of 50 screen-widths clean** (680 controls measured, 0 under the size, 0 overflow).
**Proved it can fail:** with the touch token shrunk to 30 px the same run flagged **495 controls in 36 screen-widths** (only 14 of 50 clean), listing them by name; restored.
**Not covered:** the buyer page with a real link; Setup's other sections; states (a dialog open, the Filters panel open, an error); Tamil on merchandiser screens; a mouse at the small widths.

## Commits (8 Nov 2026)

- **`cc30f72` `InBul11`: UI/UX 2.0 phase 0, foundation** (tokens and tap sizes, the component test harness, the measuring tools, the 1.0 and 2.0 picture sets, the audit documents). Checked on its own in an isolated checkout of HEAD plus only its files: typecheck clean, 189 web tests, contrast and docs checks pass. Tagged `InBul11` (the tool warned it expected InBul07: commits InBul07 to InBul10 exist without tags, an earlier gap).
- **`dda2cd7` Build 1007: Supervisors keep Send in reach, and merchandisers get tabs and a phone-friendly board** (phases 1 and 3 so far, with `docs/builds/build-1007.md`, `CHANGELOG.md`, `build-info.json`). It also carries the UI work done between build 1006 and this session that was never committed, which lives in the same files and could not be separated. Tagged `build-1007`. Full suite 1431 tests, axe 48 screens, e2e 22 of 22 on this tree.
- Left out on purpose: `scripts/zz_api.ts` and `scripts/zz_tmp_b15.ts` (scratch scripts from an earlier session). Nothing pushed.

## 3.7 to 3.10 Small merchandiser fixes (8 Nov 2026, not yet committed: they batch into the next build)

- **3.7 Review:** the two sections buyers can see are now "Photos visible to buyers now" and "Warnings visible to buyers now" (they were "Photos visible to buyers now" and "Visible to buyers now"); the summary chip's long name says what its number adds up ("Photos and warnings visible to buyers now").
- **3.8 Status page:** "Checked 4 Nov, 10:00 am IST" (the day and the time zone, from `statusRules.ts`) instead of a bare clock time, and a "← Back to the app" link, so it is not a dead end.
- **3.9 New order:** "Total –" until a size has a number, then "Total 250 pieces" (no placeholder zero).
- **3.10 History cards:** the 4 px left accent stripe on the date-change history cards is gone; a guard fails on any left border outside the timeline's own line and shapes.
- Tests: `merchandiserPolish.test.ts` (9). The stripe guard was **broken on purpose** (stripe put back: 2 failed; restored). **Measured in Edge** as above. Web tests 643 passed; typecheck clean.
- **Not checked:** the history card with a real entry (the demo has none); the status page on a phone.

## 3.5 One number rule, dates read back in words (8 Nov 2026, InBul13)

- **Numbers (audit 02 finding 5):** one formatter, `pieces()` in `numberFormat.ts` (Indian grouping from four digits: 1,750; 4,550; 1,25,000; a dash for a value that is not a number, never "NaN"). Every screen now uses it, the supervisor's Today and Update included ("1,750 / 4,550", "left 2,800"); the places that grouped by hand (Board, Buyer, Order detail, New order, the visit-entry sentence) call it too, and a test fails if any of those files groups a number by itself again.
- **Dates (finding 6):** a new atom `ui/atoms/DateWords` reads the date under every date field in words ("Thursday, 12 Nov 2026"): New order, Change date, the visit entry form and the Setup days tab. A half-typed or impossible date (31 Feb) draws nothing, so nothing wrong is read back. It is hidden from screen readers on purpose: the field already announces its own value and the words would be glued to the label.
- Tests: `numberFormat.test.ts` (5), `dateWords.test.tsx` (8). Both written first and seen failing (the wiring checks were red until the screens were changed). Web tests 658 passed; typecheck clean.
- **Measured** in Edge at 390 px with touch emulation: nothing drawn for an empty field; "Thursday, 12 Nov 2026" in the muted ink (316 px wide, no horizontal overflow).
- **Not checked:** the Tamil supervisor screens with the grouped numbers on a real phone (Latin digits with Indian grouping are used on purpose, as the board already did; supervisors should say if they would rather see Tamil digits); a screen reader on the date fields.

## 3.6 Order detail: KeyFacts tiles, gaps, one primary (8 Nov 2026, InBul14)

- **KeyFacts** (first organism, `ui/organisms/KeyFacts`): Quantity ("4,550 pieces"), Ex-factory ("20 Nov", with "Friday, 20 Nov 2026" under it) and Stages done ("0 of 1", only when the order has stages) replace the inline numbers. A description list (a screen reader hears each label with its value); no value is coloured, so the tiles read the same in greyscale and status stays the badge's job alone.
- **Finding 7:** cards that follow each other now have 16 px between them (`.card + .card`; measured 16 px between Add an update and Change the ex-factory date, it was 0), and "Change date" is an outlined button, so "Add update" is the one filled button on the page.
- Tests: `keyFacts.test.tsx` (6), written first (3 red on the page, then green). Web tests 666 passed; typecheck clean.
- **Measured** in Edge at 390 px with touch emulation and at 1280 px: no horizontal overflow; at 390 px the three tiles sit in one row (the summary card is about 120 px shorter than with the old inline numbers and the first version of the tiles, which wrapped to two rows).
- **Not checked:** an order with several stages or with sizes listed (the demo order has one stage and no sizes line); Tamil does not apply (merchandiser screen); a screen reader.
- **Fix to 3.8 found by `npm run ux` on this slice:** the status page's "← Back to the app" was a bare text link, 22 px high (under the 48 px touch size at every phone width). It is now a button (`btn`); the audit reads 50 of 50 screen-widths clean, 0 controls under the tap size.

## 4.2 and 4.5 Measured load times, a first-paint shell, a skeleton for Today (8 Nov 2026, InBul15)

**Measured first** (`npm run load`, new: builds the app, starts a demo API and the preview, drives Edge at 390 px with touch emulation). **This is emulation**: Chrome's network throttle (Slow 3G 500 kbit/s and 400 ms; Fast 3G 1.6 Mbit/s and 150 ms) and a 4x slower processor on this computer. It is not a 2 GB phone on a real network. The preview server sends no compression, so the bytes below are larger than a compressed host would send.

| | Slow 3G | Fast 3G |
| --- | --- | --- |
| First visit, sign-in screen: first paint / first content / button usable | 1.1 s / 3.3 s / 3.4 s | 0.5 s / 1.5 s / 1.7 s |
| Downloaded on that first visit | 342 KB | 355 KB |
| Sign-in tap to the list of stages | 2.0 s | 0.9 s |
| A later visit (app stored by the service worker): first content / list | 0.55 s / 1.5 s | 0.54 s / 1.1 s |

- **Reading:** the first visit on a slow connection is a bare page for over 3 s (the 1 s bar in the plan is passed), and the list after sign-in takes 2 s. A later visit is fine, so nothing was done for it.
- **4.5 First-paint shell** (`index.html`): a ring in the page colour, inside the app's root, with no words (nothing to translate). It is on screen from the moment the page arrives, so the first 3 s of Slow 3G are no longer an empty page (checked with a screenshot at 1.8 s: ring, page colour). The app clears it on mount (`#boot` is gone after the app starts: checked). The ring stands still under reduced motion. Its colours are written out in `index.html` because no stylesheet has loaded yet, and `bootShell.test.ts` keeps them equal to the tokens (the guard was broken on purpose: one digit changed, it failed; restored).
- **4.2 Skeleton** (new atom `ui/atoms/Skeleton`): only on Today's list after sign-in (2.0 s measured). Three stage-shaped grey cards replace the spinner, held back 180 ms like the spinner so a fast load never flashes; the region carries the existing "Loading your orders" words in Tamil or English; still under reduced motion; neutral grey from the tokens. Photographed on Slow 3G with the list held back.
- **Not given a skeleton:** the board and other screens (not measured over 1 s yet: only the supervisor's first sign-in was timed), a later visit (about 1 s, with real data already stored).
- Tests: `bootShell.test.ts` (5), `skeleton.test.tsx` (4); written first (4 and 1 red). Web tests 677 passed; typecheck clean.
- **Not checked:** a real low-end phone on a real network; a compressed host (the real number is smaller); the merchandiser's screens (their loading was not timed).

## 4.3 and 4.4 Empty states, and the sync chip is noticed (8 Nov 2026, InBul16)

- **4.3 Today with nothing to update** keeps its first sentence and adds "New orders appear here when your merchandiser sets them up." (`today.nothingNext`, draft Tamil, unreviewed, added to `audit/TAMIL-REVIEW.md`). It uses the word the sign-in screen already has for the merchandiser, and avoids a Tamil word for "unit", which the app does not have. The empty state cannot tell "nothing assigned" from "all done"; the wording is true for both.
- **4.3 Board with no orders** says what will appear and now gives the way to make the first one ("Set up the first order", an outlined button, not a second primary). The filtered-empty board already had its own message and "show every ..." buttons and is unchanged.
- **4.4 Sync chip:** when its tone changes (waiting to sent, sent to a problem, problem to sent) it is marked for 1.6 s: a ring in the action colour that thins away; under reduced motion a still 2 px outline instead (no motion). Not on first sight, and not while a count just goes down inside "waiting". Never green. Checked in Edge with touch emulation: offline gives `sync--wait sync--noticed`, back online "All sent" with the animation `sync-notice` (reduced motion: no animation, outline solid), and the mark is gone 2 s later.
- Tests: `emptyStates.test.ts` (4), `syncNotice.test.tsx` (7); written first (4 and 3 red). Web tests 688 passed; typecheck clean.
- **Not done in this phase:** 4.1 (Undo for "Don't show" needs a new server route: backend session; see below).
- **Not checked:** the ring on a real phone; a screen reader reading the changed chip (it was already a polite live region); whether supervisors understand the Tamil sentence.

## 8B Merchandiser desktop: the board and the order page as a dashboard (8 Nov 2026, branch `ui2-merchandiser`)

The user's answer to "I don't see a major shift from 1.0 to 2.0" was a new look and layout for both roles; this is the merchandiser desktop stream (the supervisor phone and the mock-ups are other streams). Ideas taken from the user's reference page (kindofui): the Dashboard entry (summary numbers first, as tiles) and the Bento entry (rounded cells of different sizes in one grid), kept inside the hard rules.

**Board, 1280 px (the phone keeps its chips and its density: first card still 407 of 844 px):**
- The status chips become **five tiles** (`ui/organisms/StatusTiles`): All, Late risk, At risk, No update, On track. Each has the status icon, the word and the tint (red and amber tinted, grey and green plain, so it reads in greyscale: checked), a large count, and, only where real, the pieces still short ("700 pcs short"; "920 pcs short in total" on All). A tile is a pressable button (`aria-pressed`, a heavy ink ring when on, the status in the address). Measured: each tile's number equals the rows shown after pressing it (6, 1, 1, 2, 2); Space on a focused tile works.
- Search, sort, unit and ship week are the table's own toolbar (one rounded card with the table under it); the buyer choice sits above the tiles with the update time, Refresh and New order, because it changes their numbers.
- A cleaner table: more air, a larger PO, a header band, the ship date with "in 16 days" under it (from the server's own day), the gap in bold.
- Number note: `shortByStatus()` adds up only real shortfalls under the same buyer choice as `counts()`; nothing is invented, no API field added (3.4 still waits for the backend).

**Order page, 1280 px (a bento, `ui/organisms/OrderBento`):** the order card with four large tiles (a new "Projected finish" tile from the server's own projection, with "2 days after plan"), the timeline and the stage cards **side by side**, the two actions side by side, then the history and the notes side by side. Page height 1282 px to 900 px (30% shorter, nothing to scroll to at 1280 x 900). The timeline (which scrolls sideways under about 740 px) fits its cell at this width (measured: no scroll). On a phone it is the page it was: one column, three tiles in one row (the new tile is wide-only), 16 px between the two action cards (checked: the first version of the bento took that gap away on a phone, found in the picture and fixed with a test).

- Tests first, all red then green: `dashboardBoard.test.ts` (10), `statusTiles.test.tsx` (8), `orderBento.test.tsx` (8). Mutation-checked: removing the pressed-tile ring made its guard fail, restoring it passed.
- Checks on this tree: `npm run verify` 1516 tests passed (16 skipped), `npm run a11y` 0 serious or critical on 48 screens, `npm run ux` 50 of 50 screen-widths clean, `E2E_API_PORT=8802 npm run e2e` 22 of 22, typecheck clean.
- Pictures: `audit/redesign-merchandiser/` (before and after of the board and the order page at 1280 and 390 px, and the tile row in greyscale).
- **Not checked:** the other merchandiser screens (Review, Setup, New order: unchanged); an order with several stages (the timeline then scrolls sideways inside its cell, as designed) or a long period; a screen reader on the tiles; Tamil (merchandiser screens are English); the 1000 to 1100 px width band by eye (only 1280 and 390 were looked at); a real touch device (a tablet landscape at 1024 px would get the tiles but is untested). `scripts/snapshots.ts` now clicks `.statustile--red, .chip--red`; it was not re-run.

### 8B follow-up: no tinted cards (user feedback, 8 Nov 2026)

The user said the tinted and coloured fills "feel so much of AI generation" (the pink Sewing stage card, the tinted Late risk and At risk tiles with coloured borders). Changed:
- **Status tiles:** a plain white surface with a plain soft border for every status; the status is the icon and the word in its colour; the count is ink; the pressed tile keeps its heavy ink ring.
- **Stage cards** (`.stagecard--red`) and the **board table rows** (`.row--red`, and its hover rule): no fill; the status is the badge (icon, word, colour) in the header or the first column.
- The status tint tokens stay in `tokens.css` and are used only by the small badge pill.
- **Guard:** `noStatusTints.test.ts` reads every stylesheet touched by this stream and fails if anything but a `.badge` takes a status tint as a background, or anything but a badge or an invalid field takes a status colour as a border or outline, or a tile, stage card or board row has a rule of its own for a status fill. **Broken on purpose twice** (a tinted `.stagecard--red`, then a tinted `.row--red td`): it failed both times; restored. `statusTiles.test.tsx` was changed from asserting the tints to asserting a neutral surface, the colour on the word and icon only, and an ink count.
- Checks on this tree: `npm run verify` 1520 tests passed (16 skipped), `npm run a11y` 0 serious or critical on 48 screens, `npm run ux` 50 of 50 clean, `E2E_API_PORT=8802 npm run e2e` 22 of 22. Pictures retaken in `audit/redesign-merchandiser/` (board and order at 1280 and 390, the tile row in greyscale: still reads by icon and word).
- **Not checked, and still open:** other screens keep their tinted elements where they use them (the Review, Buyer and Setup screens, the note and notice boxes): this change covers the board, the order page's stage cards and the tiles only.

## 8A Supervisor phone redesign: Today and Update (8 Nov 2026, branch `ui2-supervisor`, stream A)

Pictures: `audit/redesign-supervisor/` (before-* and after-*, 390 px, touch emulation, English and Tamil; `after-update-keyboard-*` is the phone with the keyboard up, simulated by a 500 px high viewport).

- **Today:** an ink hero (new organism `TodayHero`): a ring (new atom `ProgressRing`) with "N / M", the sentence "N of M updated today", the date the counts go to, and the sync chip inside it. Below it one large card per stage (new organism `StageCard`): the stage in an ink pill, the due date, the order number at 26 px, **"Done 1,750 / 4,550" with a real bar of pieces and the share (38%)** (new atom `PieceBar`; pure rules in `stages/pieceProgress.ts`: the share rounds down so a stage is never 100% before it is, and the bar stops at full over the plan while the numbers keep the real count), today's count with a tick once something was entered, and the one full-width 56 px Update button. Same words as before (no new i18n keys, so no new Tamil to review).
- **Update:** an ink hero (`UpdateHero`): ring with the share, the order number at 28 px, and "Today so far" and "Left" as 30 px figures; the number typed is now 36 px bold with a 2 px border (still 56 px high). The way back and the sync chip share one row; on a phone the back link is a 48 px round arrow (its words stay for a screen reader and for scripts). The bottom bar, the focus effects, the one-at-a-time save and the field's `aria-describedby` are untouched, and the bar stays inside the card (a guard: outside it the bar lost its padding and Send touched the screen edge, found by `npm run ux` 844 of 844 px).
- **Neutral surfaces (the user's rule):** no card, tile or header takes a status tint, a coloured border or a stripe; status colour stays on the badge's icon and word. Guard in `supervisorRedesign.test.tsx` (every stylesheet of these components and the stage rules in `styles.css`: no `status`/`tint`, backgrounds only white, page colour, ink or the empty-bar grey, no side border, border colours only neutral tokens). **Broken on purpose:** a red-tinted stage card made three tests fail; restored. Today's stage cards never carried a status tint (a stage has no status in this list), so nothing had to be removed.
- **Measured (390 px, touch emulation, demo data):** number field top 348 px (before 363, English) and 350 px (before 341, Tamil) of 844; with the keyboard simulated (500 px viewport) the field's bottom edge is 416 and 418 px against the bar's top at 419 px: clear, as before. Send bottom edge 832 of 844 px, 56 px high; no sideways overflow in either language. First Today card now starts lower (the hero is above it) but each card shows four things the old one did not: a real bar, the share, a large done count and a tick.
- **Checks on this tree:** `npm run verify` 1520 tests passed (16 skipped); `npm run a11y` 0 serious or critical on 48 screens; `npm run ux` 50 of 50 screen-widths clean, 0 controls under the tap size; `E2E_API_PORT=8801 npm run e2e` 22 of 22. Tests written first (the page wiring and the look were red before the pages changed).
- **One test changed:** `numberFormat.test.ts` looked for `pieces(s.qty)` in `Today.tsx` and `pieces(left)` in `Update.tsx`; the numbers are now written in `StageCard` and `UpdateHero`, so it checks them there.
- **Not checked:** a real phone (no adb in this session; the keyboard check is a simulated short viewport, not Chrome's own scroll into view), an iPhone, a low-end phone, a screen reader on the hero and cards, supervisors reading the screens (all words are the existing ones). The ink hero is a dark card on a light page: it is neutral, not a status tint, but if only white or page-colour surfaces are wanted it is a one-line change per hero (`background: var(--ink)` in `TodayHero.css` and `UpdateHero.css`).

## 8C Merge of 8A and 8B, and the colour theme (8 Nov 2026, InBul17)

- **Merged** `ui2-merchandiser` (board status tiles, bento order page) and `ui2-supervisor` (Today and Update hero cards, stage cards) into `frontend-audit`; one conflict, `audit/PROGRESS.md` (both entries kept).
- **User feedback applied:** tinted status fills felt generated, so a status colour is now only on the icon and word (and the small badge pill); heroes and tiles are neutral. The near-black hero cards did not match the theme and became light.
- **Colour theme, from the Pantone reference the user gave** (https://www.pantone-colours.com/ is a swatch chart; Pantone Violet sampled from it as `#6E5BB1`): the action colour is Pantone Violet (5.53:1 with white), with a soft wash `--accent-soft #EEEBF7` for hero cards, a lavender-tinted page `#F6F5F9`, violet-grey borders `#8A85A0` and labels `#5A5670`. Status colours (red, amber, green, grey) are unchanged. Selected chips, review counts, reason pills and every progress fill now use the action colour instead of near-black. Contrast: `check_contrast` passes, with three new pairs (accent, ink and muted on the soft wash).
- **Back button on Update** was a round ghost button with a typed arrow glyph, which looked out of place beside the square menu button. It is now the same shape as the menu button (8 px radius, same border) with a drawn arrow.
- **Not checked:** a real phone in daylight (soft tints can wash out in glare: the borders and ink carry the layout, not the tints); Review, Buyer and Setup pages were only checked by the automated screens, not by eye.

## 5.1, 5.2 and 5.3 Setup: the pilot checklist, one "Add a person" form, and account activity (8 Nov 2026, branch `ui2-setup`, not merged)

- **5.1 Pilot setup checklist** (new organism `SetupChecklist`, rules in `setup/setupChecklist.ts`, data from `useSetupChecklist`): at the top of Setup, four steps in the order a pilot is set up: **Units, Closed days, Templates, People**, each **Done**, **To do** or **Not checked** (a mark and a word, never colour alone; theme colours only, no status colours or tints). It reads the endpoints the sections already use (`/api/units`, `/api/calendar`, `/api/templates`, `/api/accounts`): **no new API field, no invented state**. Done means: at least one unit; at least one calendar entry (Sundays are closed without one, so "Only Sundays are closed so far" is still to do); at least one template; at least one supervisor who can sign in (a stopped account does not count). Each row says what exists in words ("2 units: Unit 1, Unit 2", "3 days set: 2 closed, 1 worked", "1 supervisor and 1 merchandiser can sign in") and has a button to the right section ("Add a unit" lands on the unit form). The line above the list says where things stand: "Nothing is set up yet. Start with the units." / "3 of 4 done. Left: Closed days." / "Everything is set up for the pilot." States: loading, **failed to load** (the shared failure card with Retry), nothing, partly (list open, folded on a phone behind "Show the steps"), all done (one line, list folded). One source failing makes only its own row "Not checked" ("3 of 4 done. Could not check: Templates."). It refreshes when Setup opens, when the section changes and when People changes something.
- **Template summary in words** (part of 5.2): the Templates row says "Knit tee: cutting, then sewing, then finishing, then packing".
- **5.2 One "Add a person" form** (`AddPersonForm`, rules in `setup/addPerson.ts`): a role choice (Supervisor or Merchandiser, with one line saying how each signs in), then only that role's fields; the name is kept when the role is switched; the checks the old supervisor form made are unchanged, and a few obvious ones (name, email, password length) are now said before sending for a merchandiser; the button names the role ("Add supervisor"). "Add a unit" stays its own form (a unit is not a person). **One filled button on the People screen** (it was four: three Add buttons and Save PIN): "Add unit" and "Save PIN" are plain buttons.
- **5.3 Activity**: the route `GET /api/accounts/audit` **exists** (`app.ts`, contract in `md/api.md`), so it is built: Setup > People > "Activity" lists the server's own plain-English sentence for each change (added, PIN reset, signed out, stopped, allowed) with the day, the time and "IST", the latest ten with "Show all N" for the rest; states: loading, nothing yet, list, failed (shared card). No PIN, password or hash is ever shown (the route never sends one). The people list still shows if the activity cannot load.
- **A bug found and fixed on the way:** a checklist link that changes section ("Add closed days") left keyboard focus on the page body, because the route update lands a render after the click and the focus request had already fired on the section that was going away. A request to move focus now names its section and waits for it (also used by the section buttons). A guard fails if the old pattern returns.
- **Found by `npm run ux`:** the role radios were 20 px (under the 48 px touch size). The real radio now covers the whole choice box (invisible), with the dot drawn beside the words; the audit reads 50 of 50 clean, 0 controls under the tap size.
- **Tests (written first, red then green):** `setupChecklist.test.ts` (18), `addPerson.test.ts` (8), `accountActivity.test.tsx` (9), `setupPhase5.test.tsx` (26; includes the one-primary-button and no-status-colour guards for the new CSS). Broken on purpose: a second `btn--primary` put back on "Add unit" failed the guard, restored. `npm run verify` 1626 passed (16 skipped), `npm run a11y` nothing serious on 48 screens, `npm run ux` 50 of 50 clean, `E2E_API_PORT=8804 npm run e2e` 22 of 22, typecheck clean.
- **Measured in Edge** (1280 px, and 390 px with touch emulation; a fake clock; my own demo API on another port so no shared data changed): all states (nothing, partly, all, one source failing, everything failing then Retry, loading); the unit link lands focus on the unit form and the closed-days link on that section's heading; adding a supervisor and a merchandiser through the real server showed the notice, the new person in the list, the checklist count updating ("2 supervisors and 1 merchandiser") and both entries in Activity ("m@example.test added Meena as a supervisor in Unit 1. 8 Nov, 5:19 am IST"); a refused PIN is said beside the form and nothing is sent; no sideways overflow; at 390 px the checklist folds to three lines and every button is 48 px high; arrow keys switch the role.
- **Not checked:** a real phone; a screen reader on the checklist and the role choice; a stop, allow or reset entry in Activity by eye (only "added" entries were produced; the sentences come from the server and are shown as sent); more than ten Activity entries in a real browser (the "Show all" button is covered by a component test only).
- Pictures in `audit/setup-phase5/` (before from the main checkout, after from this branch).
