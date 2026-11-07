---
name: frontend-ui-ux-audit
description: Improve and audit the frontend, UI and UX of the order-tracking app (React + Vite PWA for merchandisers, Tamil-speaking floor supervisors on cheap phones, and read-only buyers). Use when asked to review, redesign, fix or measure any screen, or to audit accessibility, Tamil, offline behaviour, responsiveness or copy.
---

# Frontend, UI and UX: skill for improving and auditing this app

A briefing for a fresh session. It assumes you remember nothing. Read sections 1 to 4 before touching anything; use 8 and 9 to audit; use 10 to ship a change safely.

This file is safe to publish: it holds no budget, rates or client detail. Keep it that way.

---

## 1. What this product is, and who uses it

Order tracking for a knitwear exporter. Supervisors on the floor send a daily count from a phone, in Tamil, often with no signal. A server works out for every order whether it will ship on time and shows its reasoning. Merchandisers see what needs attention first. Buyers get a read-only page for their own orders.

| Person | Device | Where | What they need | What goes wrong for them |
| --- | --- | --- | --- | --- |
| **Supervisor** | Cheap Android phone (2 GB), bright light, maybe gloves, patchy signal | `/today`, `/today/:orderId/:stage` | Enter a number in 3 taps, trust that it is saved, say why a stage is slow | Reads Tamil better than English; lost signal must never lose work; small targets; slow first load |
| **Merchandiser** | Desktop browser, sometimes a phone | `/board`, `/orders/*`, `/review`, `/setup` | See the orders that will be late, and why, in seconds; control what buyers see | Colour used alone; unexplained numbers; long pages; losing context |
| **Buyer** | Any browser, no account | `/buyer#<token>` | See their orders and confirmed news, nothing else | Seeing another buyer's data, internal figures, or unreviewed claims (worst case) |

The supervisor is the user the design is optimised for. If a change helps the merchandiser but costs the supervisor a tap, it needs a very good reason.

## 2. Hard rules: do not break these

These came from real incidents or from the product's purpose. A UI change that breaks one is a regression even if it looks better.

**Honesty (the product's core value)**
1. **Show only what the data supports.** No placeholder numbers that look like readings. A dash beats an estimate. No placeholder zeros.
2. **Read labels from the data.** Never write "On track" because an order exists. Status, "estimate" and source come from the server.
3. **Grey is never green.** An order with no updates, or a good rate gone quiet, is grey. A test covers this.
4. **Estimates are labelled** ("fewer than 3 days of updates"). Experimental values look pending even when they look good.
5. **State caps on screen** ("Showing 50 of 312"). Never cut a list silently.
6. **Three different empties:** "no update yet" (grey), "not applicable" (with a reason), "ran and found nothing / on track". Do not merge them.
7. **Show the working behind every colour.** "Need 467/day · making 350/day · 700 pcs short by 11 Nov." A colour nobody can explain is not trusted.
8. **A failure must be visible.** The sync chip says "could not send"; background polls that fail must not look like success.

**Colour and accessibility**
9. **Never colour alone.** Every status = icon + word + colour. Red, amber and green have almost the same lightness (about 1.0 to 1.3:1 apart); in greyscale only the icon and word carry meaning.
10. **Red, amber and green mean order status only.** Indigo is the only action colour. The sync chip and the reason picker use neutral colours on purpose.
11. **Tokens only.** No hard-coded colours in components; add or reuse a token in `packages/design/tokens.css`. After any token change run `node scripts/check_contrast.mjs`.
12. **Amber needs two colours**: a mark colour (`--status-amber`, icon and border only, 3.8:1) and a text colour (`--status-amber-text`). Never use the mark colour for text.
13. **Touch targets:** 56 px for Send and number fields on supervisor screens; at least 44 px on a coarse pointer for everything; never `user-scalable=no`.
14. **Tamil:** never truncate. Buttons grow to two lines. Tamil body text is 18 px with line height 1.6 (set via `html[lang='ta']`). Untranslated text falls back to English; **never guess Tamil**. The Tamil that exists is unreviewed and marked as such. **A supervisor with no stored language gets Tamil at sign-in** (`langRules.ts`, applied in `signIn` and when the app opens already signed in); a merchandiser stays English; a pick from the language switch is stored as a choice and always wins. Any script or test that reads English words after a supervisor signs in must set `localStorage['orders.lang'] = 'en'` first (`addInitScript`), as `e2e_offline.ts`, `snapshots.ts` and `a11y.ts` do.

**Data safety, as the UI sees it**
15. **Phones never compute status.** They send dated events; the server decides colours.
16. **"Saved" means saved on the phone; "All sent" means the server confirmed it.** Never show "sent" earlier.
17. **Never discard a supervisor's count because of a photo or a note.** A refused photo is dropped with a note; the pieces still go, and the phone says "Photo not accepted" on Update and Today instead of "sent with a photo".
18. **Never show a buyer anything internal:** colours, rates, shortfalls, notes, other buyers. Buyers see only confirmed warnings and approved photos.
19. **The server is the security boundary.** Route guards in React only choose which screen to show.
20. **Buyer link tokens live after `#`** and are removed from the address bar on load. Do not put them in a path or query string, a log, an analytics call or a Referer.

**Process**
21. **Look at it in a real browser before saying it is done.** Several bugs passed every state check and were visible only in pixels (a phone layout bug, a clipped header, a mis-set cursor).
22. **When a fix rests on a line that could be removed, a test must fail if it is.** Break the code on purpose once to prove it.
23. **Check sizes on a touch emulation, not a mouse.** The coarse-pointer rules only apply there (`npm run ux`).
24. **Browser checks record where an action landed** (what is on screen), not only that a click happened.
25. **Stage by file name when committing, never `git add -A`**: another session works in this checkout (`md/poa_backend.md`).

## 3. Run it, verify it, look at it

```bash
npm install                      # Node 20.19+ (22 recommended); no Docker needed
npm run verify                   # repo checks + markdown links + colour contrast + typecheck + all tests (about 500)
npm run dev:api                  # terminal 1: real API on an in-memory Postgres, demo data, http://127.0.0.1:8787
npm run dev -w @isocode/web      # terminal 2: the app, http://localhost:5173 (proxies /api)
npm run snapshots                # terminal 3: writes uiux/2.0 and keeps the earlier 2.0 set in uiux/2.0/previous/ (needs both servers; uiux/1.0 is frozen)
npm run ux                       # measures the UI/UX 2.0 plan's numbers with touch emulation, and audits every screen at 320/360/390/768/1280 for overflow and controls under the tap size
npm run diff                     # compares uiux/2.0 with the set kept before it, picture by picture (npm run snapshots also writes uiux/2.0/CHANGES.md); a refactor that changes nothing visible must report no change
npm run a11y                     # axe-core on every screen, 390 touch and 1280, needs both servers (8.5)
npm run e2e                      # builds the app, runs the offline browser test in Edge (stop dev:api first: same port)
VITE_API_BASE=http://127.0.0.1:8787 npm run build   # production build; refuses to run without VITE_API_BASE
```

**Demo accounts** (throwaway, in-memory data, "today" is fixed to 4 Nov 2026 so figures line up):
- Merchandiser `m@example.test` / `correct horse battery`
- Supervisor phone `98765 43210`, PIN `4321` (tap the Supervisor tab)

The demo data resets whenever the API restarts. **The demo API's clock is fixed to 4 Nov 2026 and a merchandiser's sign-in lasts 12 hours, so on any later real date a merchandiser cannot sign in from a normal browser** ("This device's date or time looks wrong"; a supervisor's 30-day sign-in is unaffected). Browser scripts therefore start their own clock at the API's "now" (`ctx.clock.install({ time: new Date(checkedAt) })`, with `checkedAt` from `GET /api/status`): see `scripts/a11y.ts` and `scripts/snapshots.ts`. In a hand-driven Playwright session do the same before signing in; in a plain browser set the computer's date to 4 Nov 2026. The service worker only runs in a production build, so "reload with no signal" works in `npm run e2e`, not in the dev server. Offline *queueing* works in the dev server (Network tab, Offline).

**Looking at it.** `uiux/1.0` holds the 31 screenshots of the app as it was at build 1006 (frozen, never regenerated), each with a caption (desktop and a 390 px phone); `uiux/2.0` is the set taken during the UI/UX 2.0 work. Nothing in `uiux/` is ever deleted. Read `uiux/README.md` first. Playwright is installed (`playwright-core`) and drives Microsoft Edge (`E2E_BROWSER=chrome` elsewhere). Read `scripts/snapshots.ts` and `scripts/e2e_offline.ts` for working examples of signing in, filling forms, going offline (`context.setOffline(true)`) and intercepting requests (`page.route`).

## 4. Map of the frontend

Stack: React 19, React Router 7, Vite 8, TypeScript, **plain CSS** (one file), no state library, no UI library, no chart library. Deliberately few dependencies. Do not add one without a strong reason.

```
packages/design/tokens.css      colour, font and size tokens (single light theme)
packages/web/
  index.html                    viewport (zoom allowed), theme-color, icon
  public/sw.js                  service worker: keeps the app and last stage list for offline
  vite.config.ts                refuses production build without VITE_API_BASE; emits precache.json and sw.js with a per-build cache name
  src/
    main.tsx App.tsx            router, one lazy chunk per screen, role guards, chunk-error reload
    styles.css                  ALL component styles (about 260 lines); imports the tokens
    i18n.ts                     English and Tamil strings (small: see 8.6), language switch
    langRules.ts                pure: which language a role starts in (supervisor with no choice: Tamil); `orders.lang` holds it, `orders.lang.src = default` marks a default that is not a choice
    api/session.ts              the only place that knows the API address, token, 401 handling
    api/sessionRules.ts         pure: read claims, store kind, plain error messages
    queue/*                     the offline queue: types, sync, controller, IndexedDB store, storage warnings
    stages/useStages.ts         supervisor's stages (live or saved copy) and the reason list
    pages/                      Login Board OrderSetup OrderDetail Review Setup Buyer Status Today Update
    setup/                      PeopleTab DaysTab TemplatesTab + setupLogic (pure)
    board/boardLogic.ts         pure: filters in the URL, counts, 50-row preview, date formatting
    orders/orderForm.ts         pure: size rows, form validation, slip text
    review/reviewLogic.ts       pure: buyer link URL, link status, severity words
    notes/reasons.ts            the built-in reason list (must match the server's: a test enforces it)
    photo/resize.ts             shrink a camera photo on the phone, upright
    photo/orientation.ts        pure: read the camera's EXIF "turn it" tag, the canvas matrix for it
    release/                    buildInfo (build-info.json in the bundle) + releaseInfo (pure: label, date, last three builds); shown in the menu, the What's new dialog and /status
    ui/                         AppBar(+menu) StatusBadge SyncChip Loading AuthImage PhotoViewer ChunkErrorBoundary ConfirmDialog(+confirmAsker) WhatsNewDialog; new components go in `ui/atoms`, `ui/molecules` (ActionBar), `ui/organisms`, `ui/templates` with their own stylesheet (rules in `ui/README.md`); `ui/bottomSlot.ts` lets the update bar share the ActionBar
  test/                         Vitest: pure logic and the queue (no DOM harness; see 8.9)
```

**Routes** (`App.tsx`): `/login`, `/status` (public), `/buyer` (link in `#`), `/board`, `/orders/new`, `/orders/:id`, `/review`, `/setup` (merchandiser), `/today`, `/today/:orderId/:stage` (supervisor). Each screen is a lazy chunk so a supervisor never downloads the board. First load is about 266 KB (85 KB gzip) for the shell and React, plus 1 to 20 KB per screen. **Not yet measured on real 3G.**

**Patterns to reuse, not reinvent**
- Pure logic goes in a `.ts` file with a test; the component only renders it.
- Filters live in the URL (`useSearchParams`), so a reload or shared link keeps them.
- State that must survive navigation lives above the view that unmounts; anything else is local.
- Key a view by the record it shows so switching records rebuilds it.
- One component for one concept: one `StatusBadge`, one `AppBar` with one menu, one `Loading`.
- Pages fetch with `apiFetch` (adds the token; a 401 signs the user out). Files that need the header use `apiBlob`/`AuthImage`.

## 5. The design system

**Tokens** (`packages/design/tokens.css`, measured against white by `scripts/check_contrast.mjs`):

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#1F2328` | text (15.8:1) |
| `--muted` | `#57606A` | labels, secondary text (6.4:1) |
| `--border` | `#8C959F` | input borders that must be seen (3.0:1) |
| `--page` / `--surface` | `#F7F7F5` / `#FFFFFF` | background / cards |
| `--accent` | `#3346A8` | the only action colour (8.1:1) |
| `--status-red` / `-tint` / `-text` | `#C24400` / `#FBEBE3` / `#A23F00` | late risk: icon / row tint / text |
| `--status-amber` / `-tint` / `-text` | `#B07800` / `#FDF3DC` / `#8A5A00` | at risk: icon and border only / tint / text |
| `--status-green` | `#1B7F5F` | on-track icon |
| `--status-grey` | `#636975` | no update, and the italic flag that can sit on the red tint (5.5:1; 4.75:1 on the red tint) |
| `--tap-min` / `--tap-primary` | `44px` / `56px` | touch targets |

One light theme only (floor screens are read in bright light). The token names are structured so a second theme could be added by redefining them.

**Status** (always an icon, a word and a colour; `ui/StatusBadge.tsx` is the only place that draws it):

| Status | Icon | English | Tamil (unreviewed) | On the board |
| --- | --- | --- | --- | --- |
| red | filled triangle with ! | Late risk | தாமத அபாயம் | tinted row, sorted to the top, shortfall shown |
| amber | outlined clock | At risk | கவனம் | badge only |
| green | hollow check | On track | சரியான நேரம் | small check |
| grey | dashed circle | No update | இன்று பதிவு இல்லை | muted badge |

**Type:** `--font-latin` is Noto Sans and `--font-tamil` Noto Sans Tamil, falling back to the system font. **They are self-hosted** (see 8.6): `src/fonts.ts` imports the 400/600/700 subsets; add a line there if the CSS starts using another weight. Tabular numerals on every quantity (`.mono`). Scale 14/16/20/24 px on desktop, 18 px body and 28 px quantity field on the supervisor phone.

**CSS vocabulary** (all in `styles.css`; learn these before adding classes):
`.card` `.btn` (`--primary` `--small` `--big` `--block` `--icon`) `.link` `.input` `.field` `.chip` (status filters) `.seg` (segmented control) `.banner` (bordered attention box) `.notice-box` (calm information) `.error` `.sub` (muted line) `.mono` `.visually-hidden` `.plain` (list reset) `.appbar` `.menu` `.badge--red/amber/green/grey` `.board` (table to cards under 720 px) `.plan` (small tables) `.stagecard` `.stage` (supervisor card) `.syncbar` `.sync` `.photobox` `.reasons` `.reason` `.lang-tag`. Breakpoint for stacking is 720 px; `@media (pointer: coarse)` raises targets to 44 px.

## 6. UX principles that shaped the screens

1. **Colour for exceptions only.** On-track orders stay quiet so red ones stand out. Only red rows are tinted.
2. **Numbers first on the supervisor screen.** Big number field, big Send, icons and short words. Studies of semi-literate users suggest numbers, icons and audio help; text hinders.
3. **One tap for the usual cause.** The "Why is it slow?" reasons are a short fixed list of big buttons; the note is optional.
4. **Save first, send after.** Everything a supervisor enters is written to the phone before any network call. The chip shows `Offline · 3 waiting`, `Sending…`, `could not send`, `Not accepted · 1` (the server refused an update; it is listed on My orders today, but only to the person who entered it: another sign-in's refused updates show only as "N from another sign-in not accepted") and `All sent` (only when nothing waits and nothing was refused).
5. **Ask once, only when it is probably a slip.** A number larger than the pieces left changes the button to "Send 99999 anyway".
6. **Refuse impossible work before doing it, in words.** The order form previews each stage's finish date before Create; a template with stages out of order is explained and cannot be saved. A late order is *allowed* (it is real) and flagged.
7. **A person stays in charge.** Nothing reaches a buyer until a merchandiser confirms it; translations are added by a person, not guessed.
8. **Plain, specific messages.** "Incorrect details. Check and try again." not "401". Never print the server address.
9. **Wrong passwords and unknown accounts look identical**, as do cancelled, expired and unknown buyer links.
10. **Say what a button did and what happens next** ("Stopped. They are signed out."; "Orders already created keep their planned dates").

## 7. Recent lessons: bugs that only looking (or a test) found

Learn from these; they were real. Each is covered by a test or a check, but similar ones will recur.
- The phone board's PO cell broke across lines because a `display:flex` row made three spans siblings. **Wrap multi-line cell content in one block.**
- A sticky header appeared offset in full-page screenshots. **Scroll to top before capturing.**
- Two buttons "Send" and "Send now" sat side by side and were mistaken for each other (by a test, and plausibly a supervisor). **Names that start the same invite mistakes.** The chip button is now "Try now".
- The "add to home screen" warning showed with nothing to lose, which teaches people to ignore warnings. **A warning should appear only when there is something at risk.**
- The form pre-filled S, M, L, XL but treated a blank XL as an error, so a valid order could not be created. **Defaults must not turn into errors.**
- Pasting "-5" became 5 pieces because non-digits were stripped. **Refuse bad input; do not repair it silently.**
- The engine averaged today's half-finished day as a full day, so a small morning update dragged a late order's rate down. **Do not show a half-finished period as a result.**
- A reviewer's English text overwrote a supervisor's English original. **Keep the original beside any edit.**
- A service worker cache missed every script because the server sent `Vary: Origin`. **Test offline behaviour in a real production build.**
- Destructive actions in Setup (sign out everywhere, stop account, delete template) ask through `ui/ConfirmDialog.tsx` (`useConfirm()`: `if (!(await confirm({ ... }))) return`, render `{dialog}` once). It is a native `<dialog>` with `showModal()`: Escape and a tap outside cancel, Tab stays inside, focus returns to the opener, and the destructive confirm is outlined in ink, never red. Do not bring `window.confirm` back.
- **A size token can lose to a later rule with the same specificity** (UI/UX 2.0, 8 Nov 2026). Send was 44 px high on a real phone, not 56: `@media (pointer: coarse) { .btn { min-height: var(--tap-min) } }` comes later in `styles.css` than `.btn--block { min-height: var(--tap-primary) }` and has the same specificity. A mouse-driven browser could not see it; only touch emulation (`hasTouch`, `isMobile`) did. Fixed with two classes (`.btn.btn--block`) and a test; `npm run ux` measures it. **Measure sizes on a touch emulation, and give the more specific rule to the more important size.**
- **Two things pinned to the bottom of the screen cover each other.** The "new version is ready" bar appears exactly when a send clears the form, which is when a bottom Send bar shows "Saved ... Sent.". One bottom region: the update bar draws itself into the ActionBar's slot (`ui/bottomSlot.ts`).
- **A literal colour is a bug waiting for a theme or a token change.** Ten had crept into `styles.css` and one into `StatusBadge.tsx`; `designGuards.test.ts` now fails on any hex or functional colour outside `tokens.css`, in any `.css` or `.tsx`.
- **The demo API's fixed clock locks merchandisers out of a normal browser** (section 3): scripts must start the browser's clock at the API's "now".
- **A script that deletes its own old output is a trap.** `snapshots.ts` removed every picture before writing the new set; it now keeps the old set (`uiux/2.0/previous/`) and never touches `uiux/1.0`.

## 8. Audit method

Run an audit as a loop, not a list: **look, measure, find the class of mistake, write the rule, search the whole repo for the same mistake, add a check.** Do not stop at the screen where you saw it.

### 8.1 Before you start
1. `npm run verify` is green. 2. Both servers are up and the demo data is fresh (restart `dev:api`). 3. Read `uiux/README.md`. 4. Pick the person you are auditing for (section 1) and stay in their shoes: do the supervisor pass on a 390 px phone with touch emulation; do the merchandiser pass on a 1280 px desktop.

### 8.2 Evidence to capture (put it in the report)
- Screenshots at 390×844 (touch) and 1280×900, English and Tamil.
- **Greyscale**: add `html{filter:grayscale(1)}`; every status must still read.
- **Colour-blind**: Chrome DevTools, Rendering, "Emulate vision deficiencies" (deuteranopia, protanopia).
- **Contrast**: `node scripts/check_contrast.mjs` for tokens; for anything new measure the actual rendered pair.
- **Keyboard only**: Tab through every screen; watch where focus goes after an action.
- **Zoom**: 200% and a 320 px wide window; no sideways scroll, no clipped text.
- **Offline**: Network tab Offline, enter updates, reload (production build), reconnect.
- **Slow**: Network throttle "Slow 3G" and CPU 4× slowdown; time first load and the first useful screen.
- **Console and network**: no errors, no failed requests, no duplicate fetches.

### 8.3 Checklist: every screen
- [ ] One clear purpose; the primary action is obvious and the only filled indigo button.
- [ ] Loading, empty, error and success states all exist and say something specific.
- [ ] No state is shown by colour alone. Status has icon, word, colour.
- [ ] Headings form an outline with **one `h1`** (see 8.4: several pages currently have two).
- [ ] Every input has a visible label (not placeholder-only) and an accessible name; errors are tied to the field and announced (`role="alert"`).
- [ ] Focus is visible (`:focus-visible` outline) and **never falls to `<body>`** after an action (move it to the next item, the heading, or the control that replaced it).
- [ ] Targets are 44 px or more on touch (56 px for supervisor primary actions); spacing prevents mis-taps.
- [ ] Numbers use `.mono` tabular numerals; dates are date-only strings (no time zone shifts); India time for anything with a clock.
- [ ] Copy is specific, short, and says what happens next. No jargon (PO, TNA, ex-factory are fine for merchandisers; not for supervisors or buyers).
- [ ] Layout survives 320 px, 200% zoom, long Tamil labels, long names, 0 and 300 rows.
- [ ] Nothing internal is visible to a buyer; nothing a supervisor should not see is on a supervisor screen.

### 8.4 Checklist: specific to this app
**Supervisor**
- [ ] Number of taps from the list to a sent update (target 3 after typing). Count them.
- [ ] Can a supervisor tell, at a glance, "saved on phone" from "server has it"?
- [ ] Is it clear that an update **adds** to today's total (it is increments, not a running total)? An open client question.
- [ ] Reason buttons and note work with a Tamil keyboard; text is not cut; the note keeps Tamil exactly as typed.
- [ ] A photo: preview shown with its size; Retake reopens the camera; Remove works; a non-picture is refused in plain words; on a real phone, rotation and the camera prompt behave.
- [ ] With 20 waiting updates, the chip and "Try now" are understandable; "N from another sign-in wait for that person" is understood.

**Merchandiser**
- [ ] Five-second test: a merchandiser names the late orders without scrolling. (Not yet run with a real person.)
- [ ] The board scales: search, sort, 300 rows. (Currently no search or sort controls.)
- [ ] Review queue: warnings, notes, photos, visible items and buyer links are five sections on one long page. Is it navigable? Is the count of waiting items obvious from the board?
- [ ] Destructive actions (stop account, sign out everywhere, delete template, withdraw a photo) are clear, reversible where possible, and use something better than `window.confirm` (native dialogs are unstyled and untranslated).

**Buyer**
- [ ] The page makes sense with no context, in a minute, on a phone.
- [ ] A bad or expired link says one calm thing and offers a next step.
- [ ] Photos load (and have text alternatives); nothing flashes the token.

### 8.5 Accessibility audit (axe is automated; a screen reader has not been run yet)
**Run it:** with both dev servers up, `npm run a11y` (`scripts/a11y.ts`) visits every screen at 390x844 touch and 1280x900 in Edge (supervisor screens also in Tamil), injects axe-core from `node_modules` with WCAG 2.0 to 2.2 A and AA plus best-practice rules, requires exactly one `h1` per screen (axe has no rule for it), exits 1 on any serious or critical violation and prints the moderate and minor ones grouped by screen. No rule is switched off; the one narrowing is that the open menu is checked on the app bar only (its popover covers the page on purpose). Add a screen to the script when you add a screen. It uses a buyer link made through the API and cancels it at the end; set `API=<url>` to run against a spare API if the demo one has locked the sign-in. A clean run is a floor: then test with NVDA or TalkBack.

**Fixed, and how (keep it this way):**
- **Setup sections** are plain buttons in a `nav` with `aria-current`, not the ARIA tabs pattern (simpler and correct: each section is a page of its own with an `h2`). After a change focus moves to that `h2`.
- **Reason picker** is real `input type="radio"` controls in a `fieldset` with a `legend`, drawn as the same big pills; arrow keys come from the browser; the click decides, so a second tap clears.
- **One `h1` per page:** the app bar title is the `h1` unless the page shows its own (Order detail, Update), when `AppBar` gets `plainTitle` and draws a `p` with the same look. The buyer page has one `h1` in every state and `h2` for the orders.
- **Board on a phone:** the table keeps explicit `role`s (table, rowgroup, row, columnheader, cell) so `display:block` cannot strip its semantics.
- **Focus after Review actions** goes to the heading of the section the action came from.

Still to verify by hand:
- **Dynamic updates**: confirm `aria-live` regions announce "Saved…", "Confirmed…", errors once and not repeatedly.
- **Focus after actions** in Review (confirm, dismiss, approve) moves to the heading of the section the action came from; verify it reads sensibly and that Setup tab changes do not strand focus.
- **Images**: photo `alt` text is generated ("Sewing photo for PO"); check it is useful. `AuthImage` shows text when a picture fails.
- **Reduced motion**: the spinner and fade stop under `prefers-reduced-motion`; check nothing else animates.
- **Language**: `<html lang>` follows the switch and Tamil originals carry `lang="ta"`; verify the screen reader switches voice.

### 8.6 Tamil and i18n audit (biggest gap for the main user)
- Only about 20 strings are in `i18n.ts`. **Most supervisor-screen text is hard-coded English** in JSX ("Today so far", "Left", "Done", "Due", "Add a photo", "Send", error messages, hints, the whole review and setup screens). In Tamil mode the supervisor sees mostly English. Extract every supervisor-facing string into `i18n.ts` keys first; write Tamil only with supervisors present.
- All Tamil in the app is **unreviewed** (status words come from a design note; reasons and a few labels were written for this build). Have three supervisors read and correct them; record who and when. Do not ship Tamil nobody has checked.
- Fonts: **now self-hosted** (`@fontsource/noto-sans` latin and `@fontsource/noto-sans-tamil` tamil, weights 400/600/700, `font-display: swap`, system fonts kept in the token stacks; `src/fonts.ts`). Six `.woff2` files, 83 kB, in the production precache (README, "Fonts"). Still to do: measure first paint on a throttled 3G profile (no preload tag yet: file names carry a hash, and swap shows the system font meanwhile), and look at Tamil on a real phone that has no Tamil font. Do not use `@fontsource-variable` or the all-subsets CSS: they ship many more files.
- Test Tamil with real typing on a phone keyboard, long words, mixed Tamil and numbers, and line height in tight components (chips, buttons, table cells).
- Dates, numbers and the digit script: decide whether Tamil mode shows Tamil numerals (probably not; confirm with supervisors).
- Right-to-left is not needed. Pluralisation is hand-written in places ("1 need attention"); check it in Tamil.

### 8.7 Performance and reliability audit
- Measure first load (shell 266 KB, 85 KB gzip) on throttled 3G and a real 2 GB phone; target under 5 s to a usable list. Check the lazy chunks do not waterfall.
- The service worker update path has a calm prompt (`ui/UpdateBanner.tsx`, rules in `ui/swUpdate.ts`, wiring in `ui/swUpdateStore.ts`): a new version waits (still no automatic `skipWaiting`), a bottom bar offers Reload, Reload posts `SKIP_WAITING`, and the page reloads once on `controllerchange` (only for our own request, with a loop guard). It stays away while Update holds unsaved input (`ui/unsentInput.ts`) or when the queue is memory-only with items waiting. Still to check on a real phone and in a production build: the full path from a second build (`npm run e2e` does not cover it), and whether other forms (order setup, setup sections) should report unsent input too. The bar cannot be seen in the dev server (no worker): in a browser script, `import()` the `?t=` URL of `swUpdateStore.ts` from the page's resource list and call `offerUpdate({ postMessage() {} })`.
- Storage: warnings appear only when something is at risk; verify on a real phone (`navigator.storage.persist()` behaviour differs by browser).
- Photos: resize quality and size (about 150 KB from a 780 KB shot), memory use with 10 queued photos, and behaviour when storage is full.
- **Photo orientation (manual check on a real phone, once per phone model).** A portrait shot is stored sideways with a hidden "turn it" tag (EXIF orientation); `photo/resize.ts` decodes with `imageOrientation: 'from-image'` so the turn is applied before the canvas re-draw drops the tag (a browser that refuses that option falls back to reading the tag itself, `photo/orientation.ts`). The maths and the tag reader are tested in `packages/web/test/photoOrientation.test.ts`, and a headless-Edge run with synthetic tags 1, 3, 6 and 8 came out upright on both paths, but no camera was involved. On a real Android phone (and an iPhone if any supervisor has one): sign in as a supervisor, open an update, tap Add a photo, take one **held upright (portrait)**, one **landscape with the volume buttons on the right**, and one **upside down**; each preview must show the scene the right way up, and after sending, the same picture in Review must match. Then tap **Retake photo**: the camera opens again and the new picture replaces the old one. Note the phone model and browser version in the audit report.
- **Full-size photo view** (`ui/PhotoViewer.tsx`, a native `dialog`, opened from `AuthImage` with `zoomable`): used on Review (waiting and visible photos). Check by hand on a phone: pinch zooms, one finger scrolls, Close and Escape return focus to the picture you tapped. Order detail and the buyer page do not show photos yet.
- Poll behaviour: the board refreshes every 60 s while visible; confirm it does not flash or reset scroll and filters.

### 8.8 Content and visual design audit
- Consistency: spacing, radii (6 to 10 px), heading sizes; there is no formal spacing scale. Propose one (4/8/12/16/24) and apply it.
- The review page and Setup People table are dense; check hierarchy and whitespace.
- Empty states should teach ("Nothing is waiting. New warnings appear here when…") rather than just say "none".
- Disabled buttons use `opacity: .55`, which is pale; supervisors may read them as broken. Consider a clearer disabled treatment plus a reason.
- Icons are inline SVG with `aria-hidden`; confirm every icon is paired with a word.
- Anything resembling a coloured accent stripe on cards is banned (a rule carried over from earlier work).

### 8.9 Testing gaps to close
- **Component tests now exist** (8 Nov 2026): `*.test.tsx` files with `// @vitest-environment jsdom` on their first line (jsdom 25 and Testing Library, dev-only), so the Node tests are unchanged. Done: `StatusBadge`, `ActionBar`. Still to add: `SyncChip`, the reason picker and the review cards. Source-guard tests remain for what jsdom cannot show (CSS, sticky, the viewport tag).
- Accessibility is automated by `npm run a11y` (8.5) but it is not in CI or `npm run verify` because it needs both dev servers. No visual regression (screenshots are for humans; they contain clock times, so they are not byte-identical): add a screenshot diff with the clock masked.
- The e2e covers the offline supervisor flow (22 checks). It does not cover the merchandiser or buyer journeys; extend it.
- Nothing has run on a real phone or against real Postgres.

## 9. Backlog: what an audit should probably find (prioritised, from known weaknesses)

**P0: affects the main user or trust**
1. Tamil coverage: extract strings, get them reviewed (fonts are self-hosted, 8.6).
2. Real-phone pass on a 2 GB Android: camera and rotation, keyboard, offline, first load.
3. Accessibility pass with axe and a screen reader; fix tabs, radio pattern, double `h1` (8.5).
4. Service worker "new version" prompt that cannot lose an entry (8.7).

**P1: merchandiser efficiency and clarity**
5. Board: search by PO, sort, saved filters, a visible Review count with a clear way to clear it, scale to hundreds of orders.
6. Break up the Review page (sections with a sticky summary, or tabs done properly) and show what is waiting from the board.
7. Replace `window.confirm` with an accessible, translated confirmation (and undo where possible).
8. Order detail: link back to filtered board, show who changed what and when more prominently, consider a stage timeline.
9. A "what's new" and build label in the app menu (the data file `build-info.json` already exists and is generated).

**P2: polish and robustness**
10. A spacing scale and a small set of layout primitives; trim `styles.css` duplication.
11. Skeleton loading instead of a spinner for lists.
12. ~~Photo viewer (zoom) for merchandisers; rotate and retake on the phone.~~ Done for Review (viewer) and Update (Retake, EXIF orientation); still to show photos on Order detail and to check on a real phone (8.7).
13. Keyboard shortcuts and a help panel for the merchandiser (none exist: only the menu handles Escape).
14. Component tests and visual regression (8.9).
15. An in-app status link and a clearer "cannot reach the server" state on every screen.

## 10. How to ship a UI change safely

1. **Reproduce or look.** Take a "before" screenshot (`npm run snapshots` or a one-off Playwright script). Write down what is wrong in the user's words.
2. **Put logic in a pure `.ts` file** and write the test first. Show it fails without the change.
3. **Change the component and CSS.** Use existing classes and tokens. Keep copy plain and specific.
4. **Typecheck and run tests:** `npm run typecheck && npm test` (or `npm run verify`).
5. **Break it on purpose** once (remove the line the fix rests on) and confirm a test fails. Restore it.
6. **Look in a real browser** at 390×844 touch and 1280×900, English and Tamil, and greyscale if status changed. Check the console.
7. **Offline check** if you touched the supervisor flow: stop `dev:api`, run `npm run e2e` (22 checks must pass), restart `dev:api`.
8. **Retake snapshots:** restart `dev:api` for clean data, then `npm run snapshots`. Check the pictures you changed.
9. **Update docs:** README status or API rows if behaviour changed; this file if you changed a rule or found a new lesson.
10. **Version it** (see `README.md`, "Development workflow"): a change a user would notice is a **build** (`node scripts/changelog.mjs --pending "<title>" "<summary>" --why .. --verified .. --next ..`, then add `docs/builds CHANGELOG.md build-info.json`, commit with the same title, `node scripts/changelog.mjs --tag`). Anything else is an **InBul** (`InBulNN: title`). Never put "(Build N)" in a title; never edit `CHANGELOG.md` by hand; no attribution lines in commits. Build reports are public: no budget, rates or client detail. Commit and push only when the owner asks.

## 11. Traps in this environment (each cost time once)

- **Shell quoting:** very long shell commands containing apostrophes or unusual characters inside heredocs have failed to parse. Write files with the editor tool, or write a small `.cjs` script to a scratch file and run it.
- **`String.replace` and `$`:** in JavaScript replacement strings `$$` becomes `$` and `$&` inserts the match. Use `split(a).join(b)` for literal replacement. This silently corrupted SQL once.
- **`printf` and CSS escapes:** `printf` turned `\2713` into a raw byte and the stylesheet stopped being valid UTF-8, so the build failed with "stream did not contain valid UTF-8". After editing CSS from a shell, decode it strictly: `new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(f))`.
- **Port 8787 left behind:** an old `dev:api` process keeps the port and answers health checks, so a "restart" can silently leave stale code running. Find processes by command line (`Get-CimInstance Win32_Process` filtered on `dev.ts`) and stop them, then start a new one detached.
- **Vite `preview` and the build guard:** the "refuse to build without `VITE_API_BASE`" check must apply to `command === 'build'` only, or `vite preview` fails.
- **Playwright selectors:** `page.click('button:has-text("Send")')` also matches "Send now". Use specific classes (`form button.btn--big`). Wait for the specific message you expect, not any old one.
- **Playwright offline:** `context.setOffline(true)` blocks the service worker's own requests too; production build only for offline reloads.
- **Windows absolute imports:** `import 'E:/…'` fails in Node ESM; use a `file:///` URL or a relative path.
- **Sticky header in `fullPage` screenshots:** scroll to top first.
- **Node engine warning:** one dependency prefers Node 22; Node 20.19+ works and CI uses 22.

## 12. Audit report template

```
# UI/UX audit: <screen or journey>, <date>, <who>
Person and device audited: …            Build: … (git tag)            Data: demo / real
## Evidence
Screenshots: … (390 touch, 1280, English, Tamil, greyscale)   Measurements: …
## Findings (most serious first)
1. <short title>
   Where: <screen / file>      Who it hurts: <supervisor / merchandiser / buyer>
   What I saw: …               Why it matters (against which rule in section 2): …
   Fix: …                      Effort: S / M / L        Test that proves it: …
## Passed checks
…
## Not checked / needs a real phone, a real person, or real data
…
## Recommended order of work
…
```

Rate findings: **S1** loses or misstates data, leaks across buyers, or blocks the supervisor; **S2** blocks a task or breaks a rule in section 2; **S3** friction; **S4** polish. Fix S1 and S2 before any redesign.

## 13. Where the deeper material lives
- `README.md`: status, how colours are decided, API, security model, workflow.
- `uiux/README.md`: every screen with a caption.
- `docs/builds/build-*.md` and `CHANGELOG.md`: what changed in each numbered build and how it was checked.
- `packages/web/test/`: the executable specification of the pure UI logic.
- `scripts/check_contrast.mjs`: the contrast gate for tokens.
- Open product questions that affect UX (the client has not answered): do supervisors enter pieces since the last update or a running total; the final list of reasons and their Tamil; whether stages overlap; real people, units and holiday calendars.
