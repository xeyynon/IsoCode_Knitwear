# UI/UX audit 03: the finished UI 2.0, both roles, 2026-11-08

Audited: `frontend-audit` at `d3b7705` (InBul18: Violet theme, stamps, tiles, hero cards, Setup checklist), run from the main checkout's dev servers (web 5173, API 8787), demo data, fake clock from `/api/status` (4 Nov 2026 10:00 IST).
Devices: Edge (Chromium 157) emulating a phone at 390x844 with touch (English and Tamil), 320x640 and 195x422 (= a 390 px phone at 200% zoom or the largest Android font), the merchandiser at 1280x900 and at 390 and 320.
Method: Playwright scripts (not kept in the repo) plus `npm run ux` and `npm run a11y`. **Nothing was changed in the app**; this is the only file added, with the pictures in `audit/audit-03/`.

## Numbers from the repo's own tools

| Tool | Result |
| --- | --- |
| `npm run ux` | 50 of 50 screen-widths clean; 704 controls measured; 0 sideways overflow; 0 controls under the tap size (48 px touch, 24 px mouse); Send 56 px and its bottom edge at 832 of 844 px (English and Tamil); phone board first card at 407 of 844 px (48%); People table: no broken words |
| `npm run a11y` | 48 screens, no serious or critical violations |
| My own checks | no sideways overflow on any screen at 320 px (supervisor Today, Update; merchandiser board, order, review, setup, new order, status); console clean apart from the one expected network error when I switched the browser offline |
| Static | no hard-coded colour (hex, rgb, hsl) anywhere in `packages/web/src`; every animation and transition has a `prefers-reduced-motion` guard (`styles.css`, `ProgressRing.css`, `Skeleton.css`, `index.html`) |

## What is fine (checked and found good)

- **Supervisor flow, English and Tamil:** sign-in (role buttons 48 px, Sign in 56 px), Today (three cards, Update 56 px, the progress hero), Update (number field 56 px and focused on arrival, Send 56 px in the bottom bar), the "more than is left" question (announced: the field's `aria-describedby` is `hint toomany`; the Send button changes to the "send it anyway" wording with the number: seen in Tamil, `sup-ta-8-update-toomany.png`), the offline queue ("Offline · 1 waiting", "Saved 120 pieces. 1 waiting to send."), the empty Today ("Nothing to update right now" plus the new second sentence) and the held-back list (grey stage-shaped blocks). Every supervisor-visible word I saw is in Tamil on the Tamil screens (the exceptions are order data, finding 12).
- **Keyboard only:** on Today the tab order is Menu, Update, Update, Update; on Update it is the number field (focused on arrival), the reason choice, the note, Add a photo, Send; on the board it is Board, Review, Setup, Menu, buyer, Refresh, New order, the five tiles, search, sort, unit, week, then each PO. Every stop showed a 3 px solid focus outline.
- **Greyscale:** Today (`sup-en-4-today-grey.png`), the board (`mer-1280-05-board-grey.png`) and the order page (`mer-1280-08-order-grey.png`) all read: the stamps keep their icon and word, the tiles keep icon and word, the bars keep their fill.
- **Status stamps and tiles:** icon, word and colour on every status; no tinted fill left; "grey" (No update) is never green.
- **Offline merchandiser board:** "Could not refresh; showing 10:00:22 AM. Try again" (`mer-1280-19-board-offline-refresh.png`), the old data stays.
- **Forms:** New order shows an error summary plus one inline message per field with the invalid fields ringed in ink (`mer-1280-10-neworder-errors.png`); focus goes to the summary.
- **Buyer page (a real link, made in Review and cancelled straight after, checked: the row reads "Cancelled"):** no overflow, the token is removed from the address, no status colour words, a bad link says "This link is not valid" (`buyer-390-01.png`, `buyer-1280-02.png`, `buyer-390-03-bad-link.png`).
- **Setup:** the checklist, Add a person, Add a unit, Activity and the other four tabs have no overflow and no sub-tap-size control at 1280 or 390.

## Findings (most serious first)

No S1 (nothing blocks use). Two S2. Sixteen S3.

1. **The Update hero overflows in Tamil at 200% zoom or the largest phone font** (S2)
   Where: `UpdateHero` at 195 px wide, Tamil. Who it hurts: a supervisor with large text on a cheap phone.
   What I saw: the order number's text ends at 201 px and the "Left" figure at 202 px, while the hero card ends at 179 px and the screen at 195 px, so "B-PO-88240" and "2,800" run past the card and are cut at the screen edge (English fits by 11 px). `npm run ux` does not catch it because the page itself does not scroll. Picture: `sup-ta-w195-update.png` (English: `sup-en-w195-update.png`).
   Fix: below about 260 px let the two figures stack in one column and let the order number wrap or shrink (`clamp`), as the card already allows the title to wrap; add a check that every hero text's right edge is inside the hero at 195 px.
   Effort: S.

2. **The board's progress bar still says "Sewing 0/1 done" for orders that are 38% made** (S2)
   Where: board rows (`mer-1280-02-board.png`) and the phone cards (`mer-390-01-board.png`). The order page and Today show 1,750 of 4,550 pieces; the board shows an empty bar. Already known as slice 3.4, waiting on a backend field; listed here because it is now the most visible gap on the main screen of the redesign.
   Fix: the backend field, then pieces words on the board. Effort: S on the UI side once the field exists.

3. **The stamp text is 11 px and the same status appears three times on the order page** (S3)
   Where: `StatusStamp.css`; the order page shows "LATE RISK" in the header, the timeline row and the stage card (`mer-1280-08-order-grey.png`).
   What I saw: 11 px capitals are the smallest text in the app (contrast is fine, 4.5:1 or better); on the board a row's stamp is clear, but three on one page repeat the same message.
   Fix: 12 px if merchandisers at arm's length find it small (ask three); keep the stamp in the header and the timeline row only, and give the stage card plain text. Effort: S.

4. **PO links on the desktop board are 23 px tall** (S3)
   Where: `.po-link` on every board row (measured 23 px, six links). The mouse minimum is 24 px; `npm run ux` reports 0 because it counts differently. Fix: `display: inline-block; min-height: 24px` (padding-block 2 px). Effort: S.

5. **The buyer page's Download button is 40 px tall on a phone** (S3)
   Where: `Buyer.tsx` "Download (Excel)" at 390 px: the only control on any screen under 48 px (`buyer-390-01.png`). Fix: the standard `btn` height on touch. Effort: S.

6. **The board's filters are split into two toolbars** (S3)
   Where: board at 1280. The buyer choice sits above the tiles on the left of "Updated, Refresh, New order"; search, sort, unit and ship week sit below the tiles in the table's own toolbar (`mer-1280-02-board.png`). Buyer is the same kind of control as the rest. Fix: move the buyer select into the lower row. Effort: S.

7. **A long buyer name stretches the board** (S3)
   Where: board at 1280 with a 72-character buyer name (shown by rewriting the board reply in the browser, not stored): the Buyer column wraps to 8 lines, each row grows to about 225 px, and the buyer select widens to 630 px (`mer-1280-20-board-long-buyer.png`). The phone board is fine (`longBuyer_p`: no overflow). Fix: two-line clamp with the full name in a tooltip, and a max width on the select. Effort: S.

8. **The Setup tabs are uneven and wrap badly on a phone** (S3)
   Where: Setup at 1280 (segments 120, 129, 120, 120 and 149 px wide) and at 390, where the five tabs wrap to three rows with "Housekeeping" alone (`mer-1280-12-setup-people.png`, `mer-390-05-setup-people.png`). Fix: equal widths, or one scrolling row on a phone. Effort: S.

9. **Page widths change from tab to tab** (S3)
   Where: the main column is 1,200 px on the board and 880 px on Review, Setup and New order, so the content jumps sideways when you switch tabs in the app bar. Fix: one width for the reading screens and one for the board; the order page already takes the board width. Effort: S.

10. **The order page's two action cards are different kinds of thing** (S3)
    Where: "Add an update" is open (its form shows) while "Change the ex-factory date" is a closed disclosure next to it, at different heights (`mer-1280-08-order-grey.png`). Fix: make both disclosures, or both panels. Effort: S.

11. **On the phone board card, the PO row is indented and the other values are not** (S3)
    Where: `mer-390-01-board.png`: "Status" and "PO" labels sit in a column with their values at x=93, while Buyer, Ship and Gap are a three-column row under them. Fix: lay the PO and the stamp out as the card's title row. Effort: S.

12. **English style and colour words appear on the Tamil supervisor screens** (S3)
    Where: "tee · navy", "tee · black" on every Today card and on the Update hero (`sup-ta-3-today.png`, `sup-ta-6-update-arrival.png`). They come from the order data. Supervisors may not read English. Fix: ask supervisors; if they want Tamil, the colours and styles need a word list (a product decision: the server stores free text). Effort: M.

13. **The Tamil progress headline takes three lines** (S3)
    Where: Today in Tamil: "இன்று 3 இல் 0 பதிவு செய்யப்பட்டது" wraps to three lines at 390 px, so the hero is about 290 px tall and the first card starts at about 310 px (English: 245 px) (`sup-ta-3-today.png`). The draft Tamil is unreviewed; shorten the wording with the supervisors (`audit/TAMIL-REVIEW.md`). Effort: S.

14. **The progress tracks are faint** (S3)
    Where: the ring and the bars: the empty part is the soft border colour, about 1.4:1 against the soft wash and 1.5:1 against white. The figure and percentage are always written, so nothing depends on the track, but in strong light the track can vanish and an empty ring looks like nothing. Fix: use `--border` at about 50% for tracks; add the pair to `check_contrast`. Effort: S.

15. **The buyer-links table keeps every cancelled link forever** (S3)
    Where: Review > Buyer links: this demo shows a dozen "Cancelled" rows from test runs, each with its own Download button (`mer-1280-11-review.png`). Fix: show working links first and fold cancelled ones behind "Show cancelled (n)". Effort: S.

16. **An unknown address silently lands on the board (or Today)** (S3)
    Where: `/no-such-page` goes to the board (`mer-1280-18-unknown-address.png`). Not a dead end, but a mistyped or old link gives no hint. Fix: a one-line "That page does not exist" note on arrival. Effort: S.

17. **No skip link** (S3)
    Where: merchandiser pages: the first tab stop is the "Board" tab and the board has seven stops before its tiles. `main` has no id and there is no "Skip to content". Fix: a visually hidden skip link as the first focusable element. Effort: S.

18. **The Pilot setup "The steps" label is a disclosure that looks like a heading link** (S3)
    Where: Setup at 1280: the steps are already shown, and "The steps" is a `<summary>` in the link colour (`mer-1280-12-setup-people.png`); on a phone it reads "Show the steps" (clear). Fix: on wide screens keep the steps open and drop the toggle. Effort: S.

## Not checked

- A real phone (no adb available): daylight and glare on the soft Violet tints, a real on-screen keyboard, the cheap-phone speed.
- An iPhone or Safari, a low-end phone, any browser except Edge.
- A screen reader (NVDA, TalkBack): the announcements are read from the markup only.
- The supervisor "sent" state: sending an update would change the shared demo data, so I stopped at the offline queue; the e2e (`npm run e2e`, 22 of 22 at InBul18) covers the real send.
- Stop, allow and reset entries in Setup > Activity (only "added" can be produced without changing accounts); an order with several stages or a long date range; the photo viewer and the "What's new" dialog (the demo has no photos); real Tamil reading by supervisors.
- Reduced motion was checked in the stylesheets (every animation has a guard), not by running each screen with the setting on.
- The 4 Nov 2026 clock is faked in the browser; the checks do not prove behaviour on a real date.
