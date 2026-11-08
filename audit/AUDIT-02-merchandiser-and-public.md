# UI/UX audit 02: merchandiser (board, order, new order, review, setup), status page, buyer error state, 2026-11-08

Person and device audited: merchandiser at 1280x900, then the board at 390x844; desktop Chrome 157 (no real touch)
Build: 1006 (branch `frontend-audit`, uncommitted changes present)    Data: demo, browser clock set to 4 Nov 2026 10:00 IST to match the demo API

## Evidence
Screenshots in `audit/`: 12 board, 13 board in greyscale, 14 empty search, 15 and 16 order detail, 17 new order, 18 review, 19 to 21 setup (people, closed days, templates), 22 status (phone), 23 board (phone), 24 buyer with no link.
Measured: overflow, headings, accessible names, target heights, focus after a tab change, console (no errors).

## Environment trap found first (not a product bug)
`npm run dev:api` fixes the server clock to 4 Nov 2026 and merchandiser tokens last 12 hours, so on any later real date the app refuses the sign-in with "This device's date or time looks wrong". The message is honest and helpful, but the demo cannot be signed into as a merchandiser from a normal browser. The supervisor token (30 days) worked only because it was already stored. I worked around it with `page.clock.install` to 4 Nov 2026. Suggested: make `dev.ts` issue longer-lived demo tokens, or print this in `README.md` and the front-end guide, section 3.

## Findings (most serious first)

1. **People table breaks words in the middle** (S2)
   Where: Setup, People (`setup/PeopleTab.tsx`, table).   Who it hurts: merchandiser.
   What I saw: "Merchandise / r" and "Activ / e" split across two lines, the Name column shows "-" for everyone, and the action buttons wrap into three rows. The actions column takes the width and squeezes the data.
   Why it matters: the text is the screen's whole content, and a broken role name looks like a bug in a screen used to stop accounts.
   Fix: no word breaking in Role and State (`white-space: nowrap`, `overflow-wrap: normal`), move the action buttons under the row or into one "Actions" menu, show "(no name)" instead of "-".
   Effort: S.   Test: a Playwright check that no table cell's text wraps inside a word (compare cell `scrollWidth` and word widths), plus a source guard.

2. **The phone board spends two thirds of the first screen on controls** (S2)
   Where: `/board` at 390 px. The first order starts 554 px down an 844 px screen. Controls take seven rows: status chips (two rows), buyer, "Updated", Refresh / Setup / waiting for review (two rows), New order, search, sort, unit and ship week. Each card is about 245 px, so about two orders fit above the fold.
   Why it matters: the board's promise is "name the red orders in five seconds without scrolling". On a phone that fails before the list starts.
   Fix: keep status chips and search; fold buyer, sort, unit and ship week into one "Filters (n)" disclosure that shows how many are active; keep Refresh and the review count in the app bar or one row; put Buyer, Ship and Gap on one line in each card.
   Effort: M.   Test: Playwright check that the first card's top is under 40% of the viewport height at 390 x 844.

3. **Toolbar controls look like four different kinds of thing** (S3)
   Where: board toolbar at desktop. Filter chips (pills), Refresh (outlined button), "Setup" and "2 waiting for review" (underlined text inside a bordered box), and "New order" (the filled indigo primary, but underlined like a link). The row also wraps unevenly: Refresh and Setup sit right, the review count and New order drop to a left-aligned second row.
   Why it matters: the primary action looks like a link and the review count, which gates what buyers see, looks like a footnote.
   Fix: one button style for actions, no underline on buttons; put New order on the right of the first row and give the review count a count badge.
   Effort: S.

4. **The board's progress bar says "0/1 done" while pieces are 1,750 of 4,550** (S3)
   Where: board rows. The bar counts finished stages, so for a one-stage demo it is empty for every order, even those with real progress. The detail page shows the real number ("1,750 of 4,550 pieces").
   Fix: for the current stage show "Sewing · 1,750 / 4,550 pcs" and fill the bar by pieces, keeping it neutral grey (not a status colour). Keep "stages done" in a tooltip or second line when there is more than one stage.
   Effort: S to M (needs the board API to send the current stage's quantity and produced).

5. **Number grouping differs between screens** (S3)
   Detail: "4,550" and "1,750 of 4,550"; board gap: "700 pcs short"; supervisor Today: "1750 / 4550". Pick one rule (comma separators from 4 digits on the merchandiser screens, none on the supervisor phone is also fine if intentional) and put it in one formatter. Effort: S.

6. **Dates are typed in the browser's format and not read back** (S3)
   Where: Add an update, Change ex-factory, New order, Closed days. The native control showed `mm/dd/yyyy` here (the browser locale is en-US); on an Indian-locale browser it is `dd/mm/yyyy`. Nothing in the app repeats the chosen date in words, so 11/04 can be April or November.
   Fix: show "Wed 4 Nov 2026" beside every date input once it is filled (the board and timeline already write dates this way). Effort: S.

7. **Two filled primary buttons side by side on the order page** (S3)
   Add an update and Change the ex-factory date are two cards that touch with no gap, and when both are open "Add update" and "Change date" are both filled indigo. Changing the ex-factory date is the riskier action (it re-schedules every stage) yet looks the same. Fix: 16 px between the cards, "Change date" outlined or a confirm that lists what will move. Effort: S.

8. **Review: two near-identical headings** (S3)
   "Photos visible to buyers now" and "Visible to buyers now" (the second is warnings), and the summary chip just says "Visible". Rename to "Warnings visible to buyers" and "Live warnings"; also use one wording for the back link ("Back to board" here, "Order board" elsewhere). Effort: S.

9. **Setup has three "Add" forms on one long page** (S3)
   People shows the table, then Add a supervisor, Add a merchandiser and Add a unit, each with a filled primary button. Fix: one "Add a person" button that opens one form with a role choice. Effort: M.

10. **Template summary is cryptic** (S3)
    "cutting (12, Unit 1) → sewing (6, Unit 1)" does not say what 12 and 6 are. Fix: "Cutting, 12 working days before ex-factory, Unit 1". Effort: S.

11. **Status page is a dead end and shows an unlabelled time** (S4)
    No link back to the app or sign-in; "Checked 10:00:00 AM" has no date or zone; "Up" and "Down" are told apart only by the word (fine for rule 9, but an icon would help). Effort: S.

12. **Small items** (S4): "Total 0 pieces" on a new order is a placeholder zero (use a dash until a size has a number); a stray "-" for a missing name; the section buttons in Setup have uneven widths; "Order tracking" brand text sits beside every page title.

## Passed checks
- **Honesty:** every board row shows the working; no-update rows say so in words ("No update on the last working day", "no output recorded yet"); grey is never green; a count of waiting reviews is on the board.
- **Greyscale:** every status still reads from its icon and word (the red row tint nearly disappears, but the badge and sort order carry it).
- **Search:** keeps its state in the address (`?q=`), counts follow it, and an empty result explains what to try.
- **Order detail:** timeline with plan above and projection below, closed days named, text version of closed days, status colour not used in the chart, the working sentence on the stage card; one `h1`, clear heading outline.
- **Forms:** every field labelled; Remove buttons named ("Remove size S"); number keypad on quantities.
- **Review:** the buyer's wording is separate from the internal figures, labelled "Only you see this".
- **Setup:** focus moves to the section heading after a tab change.
- **Buyer with no link:** one calm message with a next step; no token or internal words.
- **Console:** no errors or warnings on any screen visited. No sideways scroll at 390 px.

## Not checked
- The buyer page with a real link (needs a link made in Review), photos on the buyer page, and the "What's new" dialog.
- Housekeeping and the template editor; the confirm dialogs for stopping an account, signing out and deleting a template.
- Keyboard-only pass, 200% zoom, 320 px, Tamil on merchandiser screens (which are English by design), slow network, a screen reader.
- Real touch sizes (this browser has a fine pointer, so the coarse-pointer CSS did not apply).

## Recommended order of work
1. People table (1), then the phone board (2): visible and cheap to prove.
2. Toolbar consistency and the progress bar (3, 4).
3. One formatter each for numbers and dates (5, 6).
4. Wording and spacing sweep (7, 8, 10, 11, 12).
5. Setup forms (9) last, since it changes the flow.
