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
