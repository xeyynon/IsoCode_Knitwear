# Plan of action from audit 04

Date: 10 November 2026. Source: [AUDIT-04-user-perspective.md](AUDIT-04-user-perspective.md) (53 findings: 3 S1, 31 S2, 19 S3). Effort: **S** under half a day, **M** a day or two, **L** more. Status: **open**, **in a branch** (built on a local branch, not live), **partly live**.

How to read this: the actions are ordered by what a real client or reviewer would hit first. Eight decisions only the owner can take come before the work (section 2), because three of the biggest actions depend on them. **Effort, risk and sprint lengths are estimates (inferences from the findings and a reading of the code), not measurements; check them against the code before committing to a date.**

## 1. Actions, in priority order

### P0: before a real client or a new reviewer uses it

| Id | Closes | Action | Area | Effort | Risk | How to verify | Depends on | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PA-01 | AU-01, AU-05 (part) | Make the buyer page answer "is my order on time?": per order one plain line ("No notice from the factory" or "Notice confirmed 9 Nov"), a "Last updated" time, one sentence on what the page shows, the year on dates, each stage marked Done, In progress or Not started, and a notice column in the weekly file. | web, server | M | Shows stage state to buyers for the first time; the new server field must be read-only for the buyer role | Repeat Tom's task 2 with three people: they answer in under 10 s. API test: the buyer JSON holds only the agreed fields. Company C never appears in B's page or file. | D1 | open |
| PA-02 | AU-02 | Show date changes to the buyer: on the card "Ship date moved from 20 Nov to 25 Nov on 9 Nov", a "Date changes" list on the page, and the same in the weekly file. | web, server, data | M | Must be built from the append-only date_change table and only for that buyer's orders; the reason text can be commercially sensitive | On a private copy, move a date: page, file and API show old date, new date and when. Isolation tests pass. A compliance person can rebuild a month from the file. | D3 | open |
| PA-03 | AU-07 | Let a merchandiser cancel (archive) a wrong order: it leaves the board, counts, warnings and the buyer view and is kept with a history row. Editing quantity, sizes, colour and buyer follows later with a history row. | server, web | M (cancel), L (edit) | Touches the engine's inputs; must not break the append-only history | Create a wrong order and cancel it: board counts and the Review count drop, the buyer page no longer lists it, the history shows who and when. Server tests for roles and isolation. | D4 | open |
| PA-04 | AU-08, AU-09 | New order: ask for confirmation when the ex-factory date has passed (reuse the Change-date dialog), and list blank size rows before creating. | web | S | Low | Type 1 Oct: a confirmation appears. Leave two sizes blank: a notice names them. Unit tests like the existing date rule. | none | partly live (Change date only) |
| PA-05 | AU-33, AU-34, AU-41 | Make the demo look the same to every reviewer: restore the seeded events daily (today only notes and warnings reset), add a "Demo day" badge, and put one product sentence and a two-minute tour on the first screen. | data, web | S | The reset must be guarded by the demo setting so it can never touch a real deployment | Add a test that seeded stage quantities never decrease along a stage list (B-PO-88213 Finishing must not exceed Stitching). Read-only check of the live board. The first screen shows the sentence. | none | open |
| PA-06 | AU-12, AU-11 | Supervisor: keep the unsent number and note per stage until she sends or clears them, make "Next" a quiet link, and show "Today's total will be N" under the field while she types. | web | S | Stale drafts; the form review branch also edits the Update screen, so merge order matters | Type 555, tap Next or Back, return: 555 is there. Type 700 after 350: the line says 1,050. Component tests; the offline checks still pass. | none | open |

### P1: next

| Id | Closes | Action | Area | Effort | Risk | How to verify | Depends on | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PA-07 | AU-15, AU-16 (supervisor), AU-17, AU-18 | Sign-in help: open the supervisor form on a Tamil phone (or show two bilingual role buttons), show tries left from the third wrong PIN and a "forgot PIN" line from the start, accept a leading 0, and send a colleague to Today after sign-in. | web | S | A wrong language guess; two bilingual buttons are the safe fallback | A fresh Tamil Android profile opens the supervisor form. "090000 10002" signs in. After a sign-out and a different person's sign-in the first page is Today. | none | open |
| PA-08 | AU-10 | Let a supervisor see today's entries and correct her last entry the same day, as a correction row (never an overwrite); the merchandiser sees it marked. | server, web | M | Changes the append-only rule: needs a new event type with its own audit | Send 35, correct to 350: today's total is 350, the history shows both, the engine counts once. Tests for roles. | D5 | open |
| PA-09 | AU-21, AU-22, AU-23 | Order page: make "Add an update" and "Change the ex-factory date" look like buttons, show the English meaning beside the Tamil floor note (marked as an AI draft), and add a "Status for the buyer" line with a link to the warning in Review. | web | M | Low; the new line reads existing data | Priya names the next action within 5 s. The floor note reads in English on the order page. No layout shift when a card opens. | none | open |
| PA-10 | AU-24, AU-25, AU-28, AU-32, AU-39 | Explain and unify the words: a "How colours are decided" panel, one-line hints for TNA, ex-factory and making, a label for Gap that names its date, one word per thing, grouped numbers in the maths sentence, one time format, and clearer names for Alerts, Housekeeping and Pilot setup. | web (copy) | M | Supervisor-visible words need Tamil, marked as drafts | A glossary table shows one name per thing. A test fails if an old word comes back. Three new users can say what "ex-factory" means. | D6 | open |
| PA-11 | AU-14, AU-26, AU-27 | Review: keep the scroll position after an action, add "Mark all sure ones as reviewed", and use one verb for publishing to a buyer that says who will see it. | web | M | Bulk action must leave unsure notes alone | Repeat Priya's task 7: seven notes in under 2 minutes. Scroll position is kept. Unsure notes are untouched. | D8 | open |
| PA-12 | AU-31, AU-47, AU-49 | One back link and one top bar on every page: merge the shared back link, give Status, buyer, sign-in and 404 a brand-only bar, use "Back to the board" everywhere, and one content width. | web | S to M | Low | The back-and-bar matrix has one row per page type. A test fails if a page draws its own back link. Screenshots of each page. | D7 | in a branch (back link on four pages) |
| PA-13 | AU-03, AU-04, AU-05, AU-06 | Buyer polish: open photos large with a download, keep the link working from a bookmark (or say it does not), show the supplier name and a contact, and ship better default warning wording. | web, server | S to M | A stored token must stay out of the address bar | Click a photo: a large view, Escape closes. Open the link in a new tab. The not-valid page names a contact. The default text carries a revised-date placeholder. | D2 | open |
| PA-14 | AU-19, AU-20 | Several reasons per note: finish the checks on the branches (full tests, accessibility, browser run, pictures), merge, and try it on a preview first; ask three supervisors whether "Why is it slow?" should show only behind plan. | web, server | M | A database migration and draft Tamil | On a Tamil phone tap three reasons: the note writes itself, an edit is kept, Review shows all three. Migration test. | none | in a branch |
| PA-15 | AU-13, AU-36 | Clear the picture error on the next success or new photo, scroll errors above the bottom bar, and add "Gallery" beside "Camera". | web | S | Low | Repeat the AU-13 sequence: the error is gone after the send. | gallery answer | open |
| PA-16 | AU-29, AU-16 (merchandiser) | Add help lines: for a lost phone ("Stop account now, then Allow with a new PIN") and for a forgotten merchandiser password ("ask an administrator"). | web | S | Low | The lines appear on Setup People and on sign-in. | none | open |
| PA-17 | AU-30, AU-46, AU-50, AU-53 | Small accessibility and feedback fixes: name each Update button with its order and stage, turn spell-check off on codes, numbers and names, fix "Review 2 2 waiting", and show why Send or Sign in is disabled. | web | S | Low | A screen-reader list of the buttons names each one. No red wavy line under a PO number. The accessibility run still passes. | none | open |
| PA-18 | Not-checked items, AU-40 | Try it with real people: three supervisors on their own phones in the hall, one merchandiser for a week, one buyer contact, and a Tamil reading of the draft words. | product | M | None; it may change priorities | Repeat the task tables with real people and compare with the metrics in section 4. | none | open |

### P2: later

| Id | Closes | Action | Area | Effort | Risk | How to verify | Depends on | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PA-19 | AU-35 | Today shows the stage that is running first and folds stages that cannot have output yet. | web | M | A product rule: overlapping stages are common | Selvi finds her order in one tap; the ring's total matches what she can do today. | product rule | open |
| PA-20 | AU-38, AU-40 | Tamil: accept Tamil numerals, mark draft words in the pilot with a "report this word" link, and have supervisors read the wording. | web, product | S to M | Low | "௩௫௦" is read as 350. Draft words are visibly marked in the pilot. | PA-18 | open |
| PA-21 | AU-37, AU-42, AU-43, AU-44, AU-48, AU-51, AU-52 | Polish batch: shorter saved bar after a send, grouped date-change history rows, a denser table option, "Done" for a finished stage, one status per page, a help entry and visible shortcuts, the AI-off helper shown once. | web | S each | Low | Each item has its own before and after picture. | none | open |
| PA-22 | AU-45 | Copy last season's order and paste sizes from Excel. | web, server | L | A product question | A pasted size table creates the same order as typing it. | product | open |

## 2. Decisions only the owner can take

Each has a recommended option and the cost of each.

**D1. What may a buyer see?** (AU-01, PA-01)

- A. Keep dates and confirmed notices only: no work, but status emails continue and the brief's goal of 60% fewer emails will not move.
- B. Add a notice line, last-updated time and Done / In progress / Not started per stage (recommended): about a day or two of work; shows stage progress, not rates or percentages.
- C. Also show percentages and rates: most informative, but exposes internal numbers and invites debate.

**D2. Who is the contact on the buyer page?** (AU-05, PA-13)

- A. One contact per company, set in Setup (recommended): simplest, one field.
- B. The merchandiser who made each link: more personal, more to maintain.
- C. None: buyers email the wrong person.

**D3. Does a buyer see the reason for a date change?** (AU-02, PA-02)

- A. Dates and when only, no reason (recommended default): safe; compliance gets the history.
- B. Reason shown only when the merchandiser ticks "share reason" for that change: flexible, one more tick per change.
- C. Always show the reason: risks exposing commercial reasons such as "fabric delayed at the mill".

**D4. Orders: edit or cancel?** (AU-07, PA-03)

- A. Cancel (archive) in sprint 1, edit of fields in sprint 3 (recommended): fixes the worst case first.
- B. Edit only: bigger work, no quick way out of a duplicate.
- C. Neither; typos go to a developer: not acceptable for real use.

**D5. May a supervisor correct her own last entry?** (AU-10, PA-08)

- A. Yes, the same day, as a correction row marked for the merchandiser (recommended): keeps the history, needs a server rule.
- B. No; she asks the merchandiser (today): wrong numbers stay until someone notices.
- C. Free editing of any entry: breaks the append-only history.

**D6. The product's word for the ship date** (AU-32, PA-10)

- A. "Ship date" everywhere, with "(ex-factory)" on first mention (recommended): plain; Tamil "கெடு" needs a supervisor reading.
- B. Keep "Ex-factory" and explain it: trade term, needs a hint everywhere.
- C. "Due": ambiguous with stage dates.

**D7. The top bar** (AU-31, PA-12)

- A. Send the top-bar file you uploaded (it was not found); public pages get a brand-only bar (recommended): one consistent bar.
- B. Keep the current bar on signed-in pages only: public pages stay bare.

**D8. Should "Confirm for buyer" ask first?** (AU-27, PA-11)

- A. Keep one click, rename it "Publish to Company B", keep the preview (recommended): light, stays fast for a daily chore.
- B. Add a confirmation dialog: safer, slower; a published warning cannot be un-seen.
- C. Leave as is: uneven safety.

Also needed from the owner: whether the click animation also happens on other websites (report section 6).

## 3. Order of work, in three sprints

**Sprint 1 (about a week): P0.** PA-01 to PA-06, with PA-01, PA-02 and PA-03 waiting for D1, D3 and D4. *What a user notices:* the buyer page says something and shows date changes, a wrong order can be cancelled, New order warns about a past date, a new reviewer sees a clean demo and a first screen that explains itself, and a supervisor no longer loses a typed number.

**Sprint 2 (about two weeks): P1.** PA-07 to PA-17, with PA-12 and PA-14 first because they are already built on branches. *What a user notices:* a Tamil phone opens on the right form, the order page has real buttons and readable notes, the back link and top bar are the same everywhere, Review is quicker, photos open large, several reasons can be chosen.

**Sprint 3: the rest.** PA-08 (corrections), the edit half of PA-03, PA-18 (the field test with real people), then PA-19 to PA-22. *What a user notices:* a supervisor can fix her own mistake, and the next round of priorities comes from real people, not from this audit.

In flight and not live: several reasons per note (PA-14), the shared back link (PA-12), a finished-area redesign and dark mode. They are on local branches only; none changes what buyers see.

## 4. Metrics to watch

- **Task success without help** per person, repeating the task tables of the audit: target every supervisor task 1 to 8 "yes" and every merchandiser task "yes" (today the merchandiser's "what do I do next" is a "no").
- **Taps and seconds to send** a count: keep at 3 taps and about 1.3 s.
- **Time to find today's order:** under 5 seconds for a supervisor.
- **Buyer status emails per week** (the brief's goal is 60% fewer): Priya counts them for four weeks before and after PA-01 and PA-02.
- **Buyer test:** three buyers answer "will B-PO-88240 ship on time?" in under 10 seconds.
- **Corrections:** wrong counts fixed by the supervisor herself against by a merchandiser; orders cancelled or edited per month.
- **Lost typed work:** incidents reported, target zero.
- **Review time:** minutes for seven notes, from about 4 now to under 2.

## 5. What not to do

- No tinted fills, no coloured stripe down one edge of a card or box, no green success cards: these are the owner's standing design preferences.
- No new dependency without asking.
- Do not change what buyers can see without the owner's decisions D1 to D3.
- Do not invent Tamil words: new supervisor-visible words are drafts, marked and listed for a supervisor reading.
- Do not push work to `main` while reviewers may be using the live demo without the owner saying so; try it on a preview and on a private copy first.
- Do not overwrite a supervisor's entry; a correction is a new row.
- Do not rely on this audit alone: it was done by role-played auditors. Watch real people (PA-18).

