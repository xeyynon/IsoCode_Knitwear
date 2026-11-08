# Plan of action: UI/UX improvement with Atomic Design, 2026-11-08 (v2, reviewed)

Status: **in progress (8 Nov 2026). Decisions D1 to D4 taken; D5 decided. Done: 0.1 to 0.9, phase 1 in full (1.0 to 1.10), phase 3 except 3.4 (3.1 to 3.3, 3.5 to 3.10), and the keyboard test on a real Android phone** (see `audit/PROGRESS.md`). Phase 0 is complete (0.8 and 0.9 done: the per-screen touch and width audit, and the picture diff that makes phase 2 safe). Next: 3.4 to 3.10, then phase 2. Draft Tamil to review: `audit/TAMIL-REVIEW.md`.
Inputs: `audit/AUDIT-01-supervisor-phone.md`, `audit/AUDIT-02-merchandiser-and-public.md`, `audit/DESIGN-DIRECTION.md`, the UI/UX research and design strategy (section 8), the front-end hard rules (section 2) and shipping checklist (section 10), and the code.
v2 folds in an independent review of v1 and checks of its claims against the code (section 9).

## 1. Goal and limits

**Goal:** fix what the audits found, in order of harm, and rebuild the frontend as atoms, molecules, organisms and templates so a fix is made once. Direction: **"Atomic at the core, context-driven at the surface"**, in a **Calm Industrial SaaS** look (the current calm palette, kept).

**Will not change:** the hard rules (honesty, never colour alone, offline safety, buyer isolation, Tamil); the status model and its rules (DEC-010); no new runtime dependency.

**Tamil constraint (found in review, verified):** `packages/web/test/i18n.test.ts` fails `npm run verify` if any key shown to a supervisor (`SUPERVISOR_PREFIXES` in `i18n.ts:176`) has no Tamil. So new supervisor words **cannot** ship in English, contrary to what the front-end guide, rule 14 says. Every existing Tamil string was written without supervisors and is marked unreviewed. Decision needed (section 7, D1). Until then, supervisor slices are designed to add **no new words** where possible.

## 2. Research and what it changed

| Question | Finding | Decision |
| --- | --- | --- |
| Does a bottom-pinned button stay above the phone keyboard? | Not by default. Android Chrome resizes only the visual viewport unless the page sets `interactive-widget=resizes-content` (Chrome 108+); Safari ignores it. ([HTMHell](https://htmhell.dev/adventcalendar/2024/4/), [W3C list](https://lists.w3.org/Archives/Public/public-webapps-github/2026Aug/0162.html), secondary) | Add it to the viewport tag (missing, `index.html:6`). It applies to every page, so check sign-in (`100dvh`) and dialogs too. Real Android phone check required. |
| Skeletons or spinner? | NN/g: only for loads over about 1 s and only if the shape matches; evidence on perceived speed is mixed. ([NN/g](https://nngroup.com/articles/skeleton-screens/), [Tim Kadlec](https://timkadlec.com/remembers/2020/11/skeleton-screens/)) | Measure first; build only where a screen takes over 1 s. |
| Toast with Undo? | Undo only in a toast is hard to reach with a screen reader. ([Scott O'Hara](https://scottohara.me/blog/2019/07/08/a-toast-to-a11y-toasts.html), [Adrian Roselli](https://adrianroselli.com/2020/01/defining-toast-messages.html)) | In-place Undo; toasts only for messages with no action. |
| Undo or confirm dialog? | Consensus, not studies: dialogs get clicked through; keep them for serious, irreversible actions. ([GNOME HIG](https://developer.gnome.org/hig/patterns/feedback/dialogs.html)) | Keep the existing dialogs; Undo only where it is safe (4.1). |
| Coach marks? | NN/g: people who skipped tutorials did slightly better. ([NN/g](https://www.nngroup.com/articles/mobile-tutorials/)) | No coach mark; self-explaining screens and empty states. |
| Filters on a phone? | Baymard: most mobile filtering is poor; show applied filters; keep a few key filters visible, the rest behind one button. ([Baymard](https://baymard.com/mcommerce-usability/benchmark/mobile-page-types/filtering-options), [applied filters](https://baymard.com/guidelines/2572-applied-filters-on-mobile)) | Status chips and search visible; "Filters (n)" for the rest; removable chips for active filters. |
| Breadcrumbs? | NN/g: costly on mobile, must not wrap, poor fit for flat sites. ([NN/g](https://www.nngroup.com/articles/breadcrumbs/)) | One back link, one wording rule. |
| Wizard? | NN/g: for novices or infrequent tasks; more clicks for frequent ones. ([NN/g](https://www.nngroup.com/articles/wizards/)) | Pilot setup checklist yes; New order stays one page. |
| Gestures? | WCAG 2.2 SC 2.5.1 and 2.5.7 need single-pointer alternatives. ([2.5.1](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures), [2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)) | No swipe actions. |
| Glass, neumorphic, skeuomorphic? | Contrast failures by design. ([NN/g](https://www.nngroup.com/articles/glassmorphism/), [Wikipedia](https://en.wikipedia.org/wiki/Neumorphism)) | Never. |
| Scan pattern? | F-shaped scanning holds on desktop and mobile. ([NN/g](https://nngroup.com/articles/f-shaped-pattern-reading-web-content/)) | Status and PO first; the working sentence starts with the number that matters. |
| Low-literacy users? | Numbers fine, text a barrier, semi-abstract pictures and voice help. ([Medhi et al. 2007](https://courses.cs.washington.edu/courses/cse490c/18au/readings/medhi-2007.pdf), [ToCHI](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf)) | Numbers big and first; icons on reason pills only after testing with supervisors. |
| Touch target? | Android recommends 48 dp; WCAG 2.5.8 floor is 24 px. ([Android](https://support.google.com/accessibility/android/answer/7101858?hl=en), [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)) | Propose `--tap-min` 48 px on coarse pointers (D2). |
| Atomic Design | Five levels; work between parts and whole pages, not one way. ([Brad Frost](https://atomicdesign.bradfrost.com/chapter-2/)) | Build each part inside its real page. |

## 3. Baseline

Measured by `npm run ux` (`scripts/ux_metrics.ts`, touch emulation on phone runs, 8 Nov 2026, demo data):

| Measure | Now | Target | Note |
| --- | --- | --- | --- |
| Update, 390x844: Send bottom edge, field focused | English 1021 px, Tamil 1126 px, screen 844 px: **below the fold** | Inside the screen | No on-screen keyboard in desktop Playwright, so a real phone is still needed |
| **Update: Send button height on touch** | **44 px (English), 46 px (Tamil)** | 56 px (rule 13) | **New finding.** The `@media (pointer: coarse)` rule `.btn { min-height: var(--tap-min) }` (`styles.css:128`) comes after `.btn--block { min-height: var(--tap-primary) }` (line 25) and wins at equal specificity, so on a real phone Send loses its 56 px. A mouse-driven check cannot see this. `tapTargets.test.ts` does not guard it |
| Phone board: top of the first order card | 583 px of 844 (69%); the card is 290 px tall | 338 px or less | Earlier 554 px was measured without touch emulation |
| People table: words broken mid-word | At 1280: "Merchandiser" and "Active" (3 breaks); at 390: none (cards) | None | Cause: `.plan td { overflow-wrap: anywhere }` (`styles.css:192`) |
| Markup in `.tsx` (prefix counts, `grep -rho --include=*.tsx`) | `className="btn` 60, `<input` 34, `className="field` 38, `className="card` 26, `role="alert"` 26 | Falling each phase | Exact `className="btn"` is 9; the rest carry variants |
| Media queries | 6 `max-width`, 3 `min-width` | Mobile-first for new code | `styles.css` |
| `npm run verify` | **Green**: 1277 passed, 16 skipped, 67 files (8 Nov 2026) | Green after every slice | |

## 4. Atomic structure

New components in `packages/web/src/ui/atoms`, `molecules`, `organisms`, `templates`. **Atoms:** Button, TextLink, Input, Select, Textarea, Chip, Badge (`StatusBadge` exists), Icon, Text, Skeleton. **Molecules:** Field, ActionBar, SegmentedControl, Stat, ProgressBar, Banner, EmptyState, InlineUndo, BackLink. **Organisms:** FilterStrip, BoardCard and BoardTable, StageCard, KeyFacts, ReviewCard, PeopleTable, UpdateForm, SetupChecklist (plus AppBar, StageTimeline and the dialogs). **Templates:** SupervisorShell (owns the bottom region: ActionBar and the new-version bar), MerchandiserShell, AuthShell, PublicShell.

Each atom and molecule gets a **state table before it is built** (for the quantity field: empty, typing, valid, not a whole number, more than left, disabled, offline, saving, waiting, sent, failed). Order status and sync status never share a look.

## 5. The plan, in order

Every slice ends with section 6. "Guards" lists the source-reading tests and scripts the slice must update while keeping what they protect.

### Phase 0: foundation (no visible change)
| # | Slice | Acceptance and guards |
| --- | --- | --- |
| 0.1 | **Fix the demo clock trap**: `scripts/snapshots.ts` sets the browser clock like `a11y.ts:77`; document it in the front-end guide, section 3. Then record the baseline by script, with touch emulation | Snapshots run on any real date; section 3 numbers re-measured by script |
| 0.2 | Tokens: spacing (4, 8, 12, 16, 24, 32), radius (6, 8, 10), elevation (menu, dialog), disabled colours (**not** `--status-grey`, which means "No update"); `--tap-min` 48 on coarse pointers if D2 is yes | `check_contrast.mjs` covers the new pairs; `tapTargets.test.ts` extended so new class names are checked too |
| 0.3 | Folders and a naming README | Typecheck green |
| 0.4 | Component test harness, **only if D3 is yes** (Vitest with Testing Library and jsdom; `vitest.config.ts` must include `.test.tsx`) | One example test for `StatusBadge` |
| 0.5 | State tables for the atoms and molecules of phase 1 and 2 | Reviewed with you before building |
| 0.6 | Tokens `--on-accent`, `--border-soft`, `--scrim` replace the literal colours; a guard test fails on any hex or rgb outside `tokens.css` (allowlist: none) | Mutation-checked; contrast pair `--on-accent` on `--accent` added to the gate; no picture changes (slice 0.9) |
| 0.7 | `color-scheme: light` in the tokens and `<meta name="color-scheme">` | Test reads both; a forced-dark browser cannot recolour status |
| 0.8 | `npm run ux` also measures horizontal overflow at 320, 360, 390, 768 and 1280, and lists controls under `--tap-min` on touch, for every screen | New baseline rows in section 3 |
| 0.9 | A no-dependency PNG diff (Node `zlib`): compares `uiux/2.0` with its previous set and writes a changed-pictures table; phase 2 must change none | Tool tested on a known pair; the clock text is masked or tolerated |

### Phase 1: supervisor
| # | Slice | From | Acceptance and guards |
| --- | --- | --- | --- |
| 1.0 | **Send keeps 56 px on touch** (and the same for every `.btn--block` primary): the coarse-pointer rule must not lower it | Baseline, section 3 | `npm run ux` reports 56 px or more on touch, English and Tamil. Guard: extend `tapTargets.test.ts` to compare the effective `min-height` after the coarse rule for `.btn--block`; seen to fail on today's CSS first (rule 22). No new words |
| 1.1 | **ActionBar** in SupervisorShell's bottom region: the saved line, the "too many" banner and Send. On Update the **new-version bar shows inside the same region** (above Send), so the two never overlap (today it appears exactly when Send clears the form). `interactive-widget=resizes-content`; `scroll-padding-bottom` so a focused field is never under the bar. Send stays a submit button inside the `<form>` with class `btn--big` | Audit 01 #1, #6 | Playwright proves the bar sticks and Send is in view at 390x844 (it cannot prove the keyboard); real Android check closes it. `npm run e2e` 22 of 22. Guards: `e2e_offline.ts:58`, `snapshots.ts:136,142`, `a11y.ts:171` use `form button.btn--big`. `npm run a11y` clean, including target size with the bar over the reason pills |
| 1.2 | Sign-in: **select** (not reorder) the Supervisor tab when this phone last signed in a supervisor; remember the role **only after a successful sign-in**; no autofocus on a touch screen before a role is chosen | Audit 01 #2 | Pure rule with a test. Note: a fresh phone is English before sign-in (`langRules.ts:23`), so this helps from the second sign-in. Guards: `a11y.ts:84,92,106` click `.seg button` by position |
| 1.3 | Language as a visible pair (தமிழ் / English) on sign-in | Audit 01 #3 | Both visible and 44 px (or 48) on touch; no new words (the two names exist) |
| 1.4 | Clear disabled look for every `.btn:disabled` (global rule, every screen changes on purpose) | Audit 01 #5 | Contrast measured; snapshots reviewed on all screens. A reason line under Send would be new supervisor words (D1) |
| 1.5 | While the "too many" question is open, the field points at it: `aria-describedby` to the banner and an **ink** border. Not `aria-invalid` (more than left is allowed, `Update.tsx:74`) and not the red status border | Audit 01 #6 | Test; greyscale unchanged |
| 1.6 | Focus bug: focus the number field when the stage has loaded (today `Update.tsx:59` runs on `[queue]`, before the field exists, so focus stays on the page) | Audit 01 #7 | Test that fails on the old dependency; check the keyboard behaviour on a phone |
| 1.7 | Sign-in phone and PIN fields at 56 px; note box without a resize grip on touch | Audit 01 #8, #9 | Snapshots |
| 1.8 | Today: a context line with the date counts go to and the unit | Strategy doc | **New supervisor words: waits for D1** |
| 1.9 | After Send, **"Next stage"** under the saved line: the next of this supervisor's stages with no update today, one tap (Calley: the next action is the closest one) | Calley loop | Pure rule with a test; **new supervisor words (D1: draft Tamil, unreviewed)** |
| 1.10 | Today: **"N of M stages updated today"**, derived from the real counts and the queue, never invented (Calley progress count; the product risk is supervisors stopping) | Calley progress | Pure rule with a test; counts a stage with an update waiting on the phone; **new supervisor words (D1)** |

### Phase 2: atoms (refactor; screens must look the same)
| # | Slice | Acceptance and guards |
| --- | --- | --- |
| 2.1 | Button, TextLink, Field (Input, Select, Textarea), Chip, Banner, Text, one page at a time | Snapshots before and after; accessibility tree before and after (Playwright). Guards: `review.test.ts:137` (exact Make link markup), `focusAfterAction.test.ts:18,31` (raw `<h2>`, `<p className="error">`); rewrite each to check the same promise through the atom |

### Phase 3: merchandiser
| # | Slice | From | Acceptance and guards |
| --- | --- | --- | --- |
| 3.1 | People table: no mid-word breaks (scope the fix to `.people`; `.plan` is also on Buyer, Days, Review and New order), grouped actions, "(no name)" | Audit 02 #1 | Measured: every word of Role and State fits on one line (compare each cell's text width with its longest word) at 1280 and 390; Buyer page re-checked |
| 3.2 | Phone board: **FilterStrip** and a compact card | Audit 02 #2 | First card top at most 338 px with touch emulation; filters still in the address. Guards: `boardScope.test.ts:162`, `boardLive.test.ts:6` read `Board.tsx` |
| 3.3 | **Merchandiser navigation in the app bar** (ORCA pattern, section 8b): Board, Review (with its waiting count) and Setup as tabs, `aria-current` on the active one; the board toolbar loses its Setup and review links; New order is the board's one primary; one "Back" wording on deeper pages. Supervisor and buyer bars unchanged. **Done (D5: yes).** | Audit 02 #3, #8 | One `h1`; a11y clean; Esc and focus rules kept; the count is a pure function, tested. Guards: `a11y.ts` menu and board steps; `boardLive.test.ts` |
| 3.4 | Progress by pieces of the current stage (board API gets the stage's qty and produced; today only `stagesDone`, `currentStage`, `boardService.ts:31-33`) | Audit 02 #4 | Words, not "0 / 4,550", when nothing is reported; estimate and low-confidence labelled; over 100% handled; bar neutral, not `--status-grey`; server and UI tests |
| 3.5 | One number formatter (`en-IN`, lakh grouping, as `Board.tsx:233` already does) on every screen including the supervisor's; dates read back in words beside date inputs | Audit 02 #5, #6 | Unit tests |
| 3.6 | Order detail: **KeyFacts** tiles, spacing between action cards, "Change date" not a second filled primary | Audit 02 #7 | Status still icon and word; greyscale |
| 3.7 | Review headings; one back-link wording | Audit 02 #8 | Text checks |
| 3.8 | Status page: link back, date and zone | Audit 02 #11 | The buyer page still has no status link |
| 3.9 | New order: "Total" shows a dash until a size has a number (`OrderSetup.tsx:141`, rule 1) | Audit 02 #12 | Test |
| 3.10 | Remove the 4 px left accent stripe on the date-change history cards (`.historyitem`, `styles.css:294`); a guard test bans `border-left` accents with the timeline spine as the only allowance | TARANG rule 4.6 | Test fails on today's CSS first; greyscale and snapshot check |

### Phase 4: feedback patterns
| # | Slice | Acceptance and guards |
| --- | --- | --- |
| 4.1 | **InlineUndo for "Don't show" on a warning still waiting for review only.** Undo returns it to "waiting for review" and refreshes its wording and figures in the same transaction. Available while it stays on the screen, until the next refresh. **No Undo for "Hide from buyer"** on a confirmed warning: showing it again needs a fresh confirmation (principle 7, rule 18). Server: `dismissWarning` clears the confirmation (`warningService.ts:171`) and `refreshWarnings` skips dismissed rows, so the route is new logic, not a flag flip | Role and isolation tests; keyboard reachable; no timer. Guard: `review.test.ts:96-110` (focus after an action) |
| 4.2 | Measure first load and first useful screen with Slow 3G and 4x CPU; skeletons only where over 1 s | Stated honestly as emulation, not a 2 GB phone |
| 4.3 | Empty states: Today with nothing assigned (rewrites `today.nothing`, so new Tamil: D1), board with no orders | Each says what will appear and how |
| 4.4 | The sync chip change is noticed ("waiting" to "sent"), reduced-motion safe, **no green** (sync is not order status) | No motion under `prefers-reduced-motion` |
| 4.5 | First-paint shell in `index.html` (Calley start-up): a language-free brand mark and a spinner until the app mounts; **only if 4.2 shows a blank wait over 1 s** | Measured on Slow 3G with 4x CPU; removed by the app on mount; no words, so no Tamil |

### Phase 5: setup
| # | Slice | Acceptance |
| --- | --- | --- |
| 5.1 | Pilot setup checklist: units, closed days, templates, people, with what is done | States read from data |
| 5.2 | One "Add a person" form with a role choice (Add a unit stays separate: a unit is not a person); template summary in words | Fewer filled primaries |
| 5.3 | Setup > People "Activity" (who stopped, allowed, reset or added an account, and when) | Needed the backend's account-activity route (`GET /api/accounts/audit`) first; built once that route existed (see `audit/PROGRESS.md`) |

### Phase 6: templates, pages and the file move
| # | Slice | Acceptance |
| --- | --- | --- |
| 6.1 | Shells as templates; pages only fetch and place organisms; the mechanical file move | Every `readFileSync` path in `packages/web/test` updated in the same change (for example `unreachable.test.ts:95`); all green |

### Phase 7: re-audit
Every screen at 390 (touch) and 1280, English and Tamil, valid buyer link included; `npm run a11y` with the new states added (Filters open, Undo line, checklist, saved line with the new-version bar); `npm run e2e`; snapshots; a report comparing against section 3.

### Phase 8: explore, do not build yet
A merchandiser sidebar or navigation rail and list-detail panes on wide screens (strategy doc). Prototype and try with merchandisers before deciding.

## 6. Definition of done for every slice
1. Test first; seen to fail without the change (rule 22).
2. Guards listed for the slice updated, keeping what they protect.
3. `npm run verify` green.
4. Browser check at 390x844 with touch emulation and 1280x900; Tamil for supervisor screens; greyscale if status is touched; console clean.
5. `npm run a11y` when a screen or a state changed (add new screens and states to `scripts/a11y.ts`); buyer page checked when shared CSS changed.
6. `npm run e2e` when the supervisor flow changed (stop `dev:api` first).
7. Snapshots and `uiux/README.md` captions updated where a screen changed.
8. Docs: README status; the front-end guide when a rule or lesson changes.
9. One line in an `audit/` progress log: what changed, measured before and after, and what was not checked.
10. Browser checks record **where the action landed** (what is on screen), not only that a click happened (TARANG TF-031).
11. Commit only when you ask, **staging by explicit file path** (never `git add -A`), so work on the backend and work on the screens never end up in one commit. Use a git worktree when both run at once.
12. A new decision gets the next free DEC number in the decisions log, checked at write time (the backend work adds them too).
13. Commit only when you ask (user-visible slices batch into a build, the rest are InBuls).

## 7. Decisions needed from you

| # | Decision | Options | My recommendation |
| --- | --- | --- | --- |
| D1 | New supervisor words, given the test requires Tamil | (a) I write draft Tamil marked unreviewed, as all current Tamil was, and add it to the supervisors' review list; (b) supervisors write it first; (c) change the test to allow "awaiting Tamil" keys | **Decided (a)**, 8 Nov 2026. Draft Tamil is kept in one list for the pilot review |
| D2 | Touch target on phones | 44 px (now) or 48 px (Android guidance) | **Decided: 48 px** |
| D3 | Component test harness (2 to 3 dev-only packages) | Yes or no | **Decided: yes** |
| D5 | Merchandiser app-bar navigation (slice 3.3, ORCA pattern) | Yes, or keep the toolbar links | **Decided: yes** (8 Nov 2026). Built: see `audit/PROGRESS.md` |
| D4 | Start point | Phase 0, then Phase 1 | **Decided: yes** ("proceeding with UI/UX 2.0") |

Progress log: see `audit/PROGRESS.md`.

Outside help: a real Android phone (and an iPhone if one exists); supervisors for the Tamil review; the client's answer on count since last update or running total.

## 8. Second strategy document: what we take, adapt or decline

Source: the UI/UX research and design strategy, written without the code.

**Taken:** atomic core with context-driven surface; Calm Industrial SaaS; a state table per component (0.5); order status and sync status kept apart (already true; kept as checks); build components inside real pages; GOV.UK Design System as a reference for errors, banners, summary lists and buttons; Today's context line (1.8); the human-centred loop with supervisors on real phones (phase 7).

**Adapted:** 48 dp targets (D2); Bento only on Order detail, not on the board (the status chips already are the counts; "one home per fact", "the table is the dashboard"); New order stays one page (frequent task), the stepper idea becomes the setup checklist; one back link instead of breadcrumbs (two levels deep); skeletons only after measuring; toasts only without actions; sidebar and list-detail go to phase 8.

**Declined:** a new "Needs review" order status and an on-track look without green (the status model is the engine's and the client's, DEC-010; on track is already quiet); hiding "Today so far" and "Left" until the count question is answered (built and useful; the hint already says what is meant); reusing gallery images (licences unknown).

**Its open questions, against the code:** count since last update or running total, **open** (DEC-017); rate window, **built** (last 5 completed working days, at least 3, DEC-021), needs client confirmation; calendars, **built** per unit; one stage, several units, partly (one unit per stage, merchandiser on-behalf entries); offline conflicts, **built** (refused updates kept with the reason); Tamil numerals, **open**; who approves buyer wording, **built** (any merchandiser); link expiry, **built** (1 to 180 days, default 30, cancellable, hash only); photo retention, partly (rejected files clearable; no written policy).

## 8b. Your other projects' guides: what we take, adapt or decline (v3)

Sources: the TARANG frontend guide, the ORCA top bar and frontend guides, and the Dukaan Dost and Calley guides (including the Dukaan skills catalogue). Each point was checked against this codebase first (greps run 8 Nov 2026).

**Taken, because the code shows the gap**

| Lesson (from) | Evidence here | New slice |
| --- | --- | --- |
| A test fails on any literal colour; text on a filled colour is its own token (Dukaan `on-green`, TARANG rule 12) | `styles.css` has five literal `#fff` (lines 24, 46, 66, 307, 375), three `rgb(140 149 159 / .35)` and two scrims; `StatusBadge.tsx` has `#fff` in its icon. No `--on-accent` token | **0.6** tokens `--on-accent`, `--border-soft`, `--scrim` and a guard test (mutation-checked) |
| Declare `color-scheme` so native controls match and a browser's forced dark mode does not recolour status (TARANG 3.5, Dukaan 5.3) | No `color-scheme` anywhere (`index.html`, `tokens.css`). Our one light theme is read in bright light, and red, amber and green must not be inverted | **0.7** `color-scheme: light` in the tokens and the viewport head, with a test |
| The browser audit measures overflow at many widths and every control under the tap size on touch, per screen (Dukaan B8) | `npm run ux` measures a handful of numbers; the Send 44 px bug was only found because of touch emulation | **0.8** extend `npm run ux`: horizontal overflow at 320, 360, 390, 768 and 1280, and a list of controls under `--tap-min` on touch, for every screen |
| Run the snapshots against the old images and list what changed; a refactor that should change nothing must change no picture (Calley A3, Dukaan B8 point 7) | Phase 2 is exactly that refactor; there is no image comparison | **0.9** a no-dependency PNG diff (Node `zlib`) comparing 2.0 with its previous set, with a changed-pictures table written beside the pictures |
| One accent stripe is banned, in any colour, and the ban ships a grep (TARANG 4.6) | `.historyitem { border-left: 4px solid var(--ink) }` (`styles.css:294`), on the date-change history cards. (`.timeline__item` border is a structural spine, which that rule exempts) | **3.10** remove it, and a guard test with that allowlist |
| After Send, the next action is the closest one (Calley "Call next", the dial, outcome, next loop) | After a send the supervisor goes back to the list, then taps the next stage. Supervisors typically have a few stages | **1.9** "Next stage" under the saved line (the next stage with no update today); new words (D1) |
| A visible progress count on the repeated task (Calley "12 of 50 logged") | The product's biggest risk is supervisors stopping. Today has no "how many have I done" | **1.10** Today: "N of M stages updated today", derived from real counts, never invented; new words (D1) |
| Backend and screen work in one folder: stage by file name, never `git add -A`; consider a worktree (Dukaan A3) | The backend work was going on in the same checkout; about 165 files were modified | Commit hygiene rule in section 6 |
| Two people gave out the same decision number (Dukaan A3) | The decisions log had DEC-024 to DEC-026 that the UI work did not write | Check the last number at write time; record UI decisions as DEC entries |
| The registers are used: tried and failed, tried and implemented (all guides) | Both were still empty templates | Filled with the UI lessons so far |

**Adapted**

| Lesson | What we do instead |
| --- | --- |
| ORCA's app bar (primary views as tabs in the centre, search as an icon that grows, one hamburger for the rest) | **Merchandiser only** (a supervisor has one flow and no navigation): Board, Review with a count badge and Setup as tabs in the app bar; the board toolbar loses its Setup and review links; New order is the board's one primary button; deeper pages keep one "Back". It answers audit 02 #3, the three back-link wordings and "how many are waiting" being visible everywhere. **Slice 3.3 is rewritten to this, pending your yes (D5).** Not copied: the three floating capsules (our bar is already calm and works on a phone) |
| ORCA's rule: a bar's entrance animation with fill-mode `both` or `forwards` keeps a `transform`, which makes that element the containing block of fixed and absolute children | In `ui/README.md` as a rule for the ActionBar and any overlay: no transform animation on an ancestor of a sticky or fixed child; check "sticky really sticks" in the browser (an ancestor with `overflow` also breaks `position: sticky`) |
| ORCA and TARANG: CSS beside each component (`Button.tsx` and `Button.css`) | Used for new atoms and molecules; the global base stays in `styles.css`. Vite splits CSS per lazy screen, so supervisors may download less CSS: measured in 4.2, not assumed |
| ORCA layers table: atoms and molecules never fetch; pages and hooks fetch; `lib` is pure | Added to `ui/README.md` as rule 8 |
| Calley's three kinds of wait (a button's spinner, a skeleton for a small block, a loader for a whole section) and a start-up screen before JavaScript | Only after measuring (4.2); a first-paint shell in `index.html` is **4.5**: a language-free brand mark and a spinner, shown until the app mounts |
| Dukaan's activity log (who did what) | Setup > People "Activity" **once the backend's account-activity route exists** (slice 5.3; it does now and the slice is built) |
| Calley's centring rule (centre one focal block, left-align what is scanned, cap the column) | Already how Login and Update behave; the supervisor column is capped at 560 px; no change |
| "Browser checks record where they landed, not only that the click happened" (TARANG 13.5, TF-031) | Added to the definition of done |

**Declined**

| Lesson | Why not here |
| --- | --- |
| TARANG's screen-change cover and branded loading mark | A fixed 700 ms cover hides state and slows a supervisor; our `Loading` already waits 180 ms before showing |
| Auto, Light and Dark themes (Dukaan, TARANG, ORCA) | Our one light theme is deliberate (bright light on the floor); a dark theme would need every status pair re-measured. Tokens stay structured so it could be added |
| Glass, glows, blobs (Dukaan then dropped them; TARANG reversed them) | Already rejected; the history agrees |
| Flutter specifics (Semantics, golden tests) and the Dukaan composer | Different stacks; the ideas they carry are taken above |
| "Use letters" PIN switch (Dukaan) | Our PINs are digits by design and easy ones are refused |
| Calley's "sample data" banner and demo-login card | Not part of a production supervisor app; the demo is dev-only |

## 9. Verification of this plan

| Check | Result |
| --- | --- |
| Baseline tests | `npm run verify` exit 0: 1277 passed, 16 skipped, 67 files |
| Code facts in this plan | Confirmed by grep and reading: viewport lacks `interactive-widget` (`index.html:6`); no undo route (`app.ts:310` dismiss only) and dismiss clears confirmation (`warningService.ts:171`); board row lacks pieces (`boardService.ts:31-33`); supervisor keys must have Tamil (`i18n.test.ts:15-18`, `i18n.ts:176`); focus effect on `[queue]` (`Update.tsx:59`); `en-IN` grouping (`Board.tsx:233`, `OrderSetup.tsx:141`); `.plan td` breaks anywhere (`styles.css:192`); media query counts; markup counts (as prefix counts) |
| Independent review of v1 | Two blockers (Tamil test; Undo scope) and nine should-fix items, each checked against the code and folded into v2: Send selector guards, the new-version bar clash, `aria-invalid` misuse, global disabled rule, sign-in guards in `a11y.ts`, source-reading tests per slice, progress-bar honesty, `.plan` scope, the snapshot clock trap, and acceptance that desktop Playwright cannot prove |
| Hard rules | Every slice checked against the front-end guide, section 2; status colours never used for sync, disabled or neutral bars; buyer rules untouched except 4.1, which is limited so nothing reaches a buyer without a fresh confirmation |
| Not verifiable here | Phone keyboard and `interactive-widget`, real touch, real 3G on a 2 GB phone, the Tamil wording, merchandiser and supervisor reactions |
