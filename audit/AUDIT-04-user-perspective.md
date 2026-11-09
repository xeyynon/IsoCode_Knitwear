# Audit 04: the system from a user's point of view

Date: 10 November 2026. Checked against the code that is live (GitHub `main`, commit `b88bb5d`) and the live app https://isocode-knitwear.vercel.app. The plan of action that follows from this report is in [POA-AUDIT-04.md](POA-AUDIT-04.md).

## 1. Summary for the owner

Four auditors went through the system as people who just want to use it. One played a supervisor on a cheap phone, one a merchandiser at a desk, one played both a buyer and a first-time evaluator, and the fourth looked across every screen at consistency, wording and learnability. Together they found **79 problems; after merging duplicates there are 53: 3 that stop a person doing the job or mislead them (S1), 31 that confuse or slow them (S2), and 19 of polish (S3).** Nothing leaked data in these audits, and the core flows work.

**What a person can do today.** A supervisor can send her day's count in 3 taps and 1.3 seconds, and it is safe with no signal. A merchandiser sees which orders are in trouble in 2 seconds and can understand why. A buyer can open his link and download a weekly file that opens correctly in Excel. A reviewer gets into all three roles in about four minutes.

**What matters most (three things).**

1. **The buyer side does not yet deliver what the brief promises.** The buyer cannot tell whether his order is on track (AU-01) and cannot see that a date was moved (AU-02). The brief asks for both: buyers should see progress without emailing, and their compliance teams want a history of every date change.

2. **Mistakes cannot be undone.** A wrong order cannot be edited or cancelled (AU-07), a wrong supervisor count cannot be seen or corrected (AU-10), and typed numbers and notes disappear when the wrong button is tapped (AU-12).

3. **Words and consistency.** The way back, the top bar and the names of things change from screen to screen (AU-31, AU-32), and jargon such as "ex-factory" and "TNA" is never explained (AU-25).

**Honest verdict per person.** *Supervisor:* usable today, with small things that make her distrust it. *Merchandiser:* good for reading and understanding, not yet for acting or for fixing mistakes. *Buyer:* not ready to hand to a real client. *Evaluator:* a professional first impression, spoilt by a first screen that does not say what the product is and by one odd number in the demo data.

An important limit: **the four people were played by AI auditors, not real supervisors, merchandisers or buyers.** They found real defects and measured real behaviour, but the owner's next step should still be to watch three real people use it (PA-18).

### Counts after merging duplicates

A finding that affects two kinds of person is counted for both, so the rows add up to more than the total.

| Who is affected | S1 | S2 | S3 | Total |
| --- | --- | --- | --- | --- |
| Supervisor (Selvi) | 0 | 13 | 11 | 24 |
| Merchandiser (Priya) | 2 | 16 | 13 | 31 |
| Buyer (Tom) | 2 | 6 | 3 | 11 |
| Evaluator (Meera) | 0 | 5 | 5 | 10 |
| **All findings, each counted once** | **3** | **31** | **19** | **53** |

Where the 79 source findings came from (before merging): supervisor 16 (0 S1, 8 S2, 8 S3), merchandiser 22 (2, 12, 8), buyer 9 (2, 5, 2), evaluator 8 (0, 3, 5), consistency lens 24 (0, 9, 15). A merged finding takes the highest severity of its parts. Each finding below lists the original ids in square brackets.

## 2. Who we tested as, and how

| Person | Who they are | Device |
| --- | --- | --- |
| Selvi, supervisor | 40, reads Tamil far better than English, cheap cracked Android phone, patchy signal, bright loud hall, thumb only, a few minutes between jobs | Phone 390 x 844 with touch, also 360 and 320 wide, Tamil first |
| Priya, merchandiser | 29, Excel open all day, 12 live orders, phones supervisors, answers two buyers' emails | Laptop 1366 x 768 and 1920 x 1080, phone 390 x 844 |
| Tom, buyer | 34, sourcing manager at a UK retailer, one link, no account, English | Laptop, phone on a train |
| Meera, evaluator | A reviewer with 20 minutes and a link, never seen the product | Laptop and phone |
| Consistency lens | Counted every screen and state (90 captured screens, 97 pictures) | Desktop and phone, English and Tamil |

**Two environments.** The live app, **read-only**: only the documented correct logins, no failed sign-in, nothing sent, created or changed. And a **private copy** of exactly the live code, with the brief's demo data, where the auditors made every mistake a real person makes (wrong PINs, past dates, blank rows, bad photos, going offline).

**Limits.** The people were role-played. Speed numbers are emulated (Slow 3G, a 4x slower processor), not a real cheap phone. The auditors read Tamil but are not native speakers. A short period of the audit ran while the computer's C: drive was full; all output was moved to E: and no finding was affected. The four original reports stay on this machine beside the audit folders (`ui2fix\audit4*`); the pictures that matter are copied into `audit-04/`.

## 3. Task results per person

**Selvi, supervisor.** Result is: yes, yes with difficulty, partly, or no.

| Task | Result |
| --- | --- |
| First sign-in | Yes, with difficulty: 5 taps, about 5 s, but the first screen is English and for merchandisers (AU-15) |
| Wrong or forgotten PIN | With difficulty: the same vague message five times, then a 15-minute lock (AU-16) |
| Find today's order | Yes, with difficulty: 5 cards, the active ones are not first (AU-35) |
| Send today's count | **Yes: 3 taps, 1.3 s to saved** |
| A wrong count | Too big: yes, a polite question. Too small or wrong: **no**, she cannot see or fix it (AU-10) |
| Slow day: reason, Tamil note, photo | With difficulty: one reason only, camera-only photo, error hidden (AU-19, AU-36) |
| No signal | **Yes, and it feels safe**; synced in 0.5 s when the signal returned |
| App closed or phone died mid-typing | Partly: a queued update survives, typed text and a typed number are lost silently (AU-12) |
| "Did the office get it?" | Partly: "All sent" means the phone handed it over, not that anyone read it (AU-39) |
| Language, sign out, hand the phone over | Yes, with difficulty: the warnings are good, the colleague lands on the wrong page (AU-18) |
| A week of use | Yes: about 3 taps per stage, role and language remembered, a 30-day sign-in |

**Priya, merchandiser.**

| Task | Result |
| --- | --- |
| First sign-in | Yes; no forgot-password path (AU-16) |
| Which orders are in trouble now | **Yes, in 2 seconds** |
| Why is B-PO-88240 red | Yes, with a small hesitation ("short by 10 Nov") |
| What do I do about it | **No**: nothing on the page offers a next step (AU-22) |
| Create an order from a PO | With difficulty: three silent mistakes accepted (AU-08, AU-09) |
| The buyer moved the date | Yes: a reason is required, 5 stage dates move, the history says who, when and why |
| Review supervisors' notes, warnings, photos | With difficulty: one click per item, about 4 minutes for 7 notes (AU-26) |
| Give a buyer access, cancel it, the weekly file | Yes for the link; the buyer page cannot show progress (AU-01) |
| Add or stop a person, lost phone | With difficulty: which button for a lost phone (AU-29) |
| Closed days and templates | Yes; the help text is good here |
| Find one buyer's orders, ship week, unit | Yes: filters are in the web address, so bookmarkable |
| On her phone | With difficulty: very long pages |
| A Monday morning | Partly: board, then Review, but nowhere to go from a red order; she still answers buyer emails |

**Tom, buyer.**

| Task | Result |
| --- | --- |
| Open the link | Yes, in about 1 second; the page does not say whose it is (AU-05) |
| Will B-PO-88240 ship on time | **No**: planned dates only, a red order looks like a healthy one (AU-01) |
| Understand the stage dates | Partly: all are plans, nothing says which are done (AU-01) |
| Read a warning | Yes, but it alarms without informing (AU-06) |
| See a photo large | **No**: a thumbnail that cannot be opened (AU-03) |
| History of date changes | **No**: not there for a buyer (AU-02) |
| The weekly file | Yes: opens correctly in Excel, but thin (AU-02) |
| A cancelled or expired link | Yes: calm and clear, but names no contact (AU-05) |
| On a phone | Yes: no sideways scroll, 48 px Download button |
| Other buyer's orders, pieces made | He cannot, and is not told why (AU-01) |

**Meera, evaluator.**

| Task | Result |
| --- | --- |
| What is this? (first screen) | **Does not know** (AU-34) |
| Sign in as each role in 5 minutes | Yes, about 4 minutes, no help |
| Find the strongest part | Yes: the board with the maths, Review with the AI's "not sure", the Tamil phone |
| Try to break it | Mostly held: signed-out deep links, 404, empty forms, wrong password |
| Anything unfinished or dead | Nothing dead; one number looks wrong (AU-33) |
| Design consistency | Uneven in one place: the back controls (AU-31) |
| Does it explain itself | Partly: Review and the maths do; no colour legend (AU-24) |
| First-impression speed | Good: sign-in ready in 0.6 s on laptop and phone |
| Trust and professionalism | Mostly professional |
| Hand to a real client tomorrow | **Not yet, for the buyer side** |

## 4. The findings

Severity: **S1** a person cannot do the job, loses data, is misled or sees what they must not. **S2** confused, slowed or distrusts. **S3** polish.

Status: **Open**, **In a branch** (built and tested on a local branch, not on GitHub or live), **Partly live**. Several things the earlier bug cycle fixed were confirmed working by the auditors and are listed in section 5, not here.

### The buyer sees too little

**AU-01 (S1) The buyer's page cannot say whether an order is on track, so it cannot replace a status email** — Buyer, Merchandiser [U-B-01, U-M-02, U-C-08, U-B-07, U-B-08, U-B-09]

The page is headed "Order status" but shows quantity, ship date and the planned finish of each stage, and nothing else. There is no status, no current stage, no "last updated", no sentence saying that only confirmed notices appear and daily output is internal, no year on the dates, and a stage that is done looks the same as one that is only planned. On the live demo B-PO-88240 is "Late risk" inside the factory, but nobody has confirmed a warning, so Tom sees a calm card.

*Why it matters:* "No news" reads as "good news", which is the surprise this product exists to remove. It is also why Priya still answers status emails; the brief's own success measure (buyer status emails down 60%) will not move on this page as it is.

*Evidence:* [screenshot](audit-04/AU-01-buyer-page-no-status.png). *Status:* Open.

**AU-02 (S1) A date change is invisible to the buyer** — Buyer [U-B-02, U-B-09]

The auditor moved B-PO-88213 from 20 to 25 Nov with a reason. The buyer page and the weekly file then show only "ships 25 Nov" and the moved stage dates: no "was 20 Nov", no date of change, no history. The buyer API carries only po, style, colour, qty, exFactory, milestones, photos and warnings (checked in the code). The weekly file has no status or last-updated column either.

*Why it matters:* The brief says buyers' compliance teams want a history of every date change. Today Tom could find out only by comparing last week's file with this week's, and the factory could be accused of moving dates quietly.

*Evidence:* [screenshot](audit-04/AU-02-buyer-new-date-no-history.png). *Status:* Open.

**AU-03 (S2) A photo cannot be opened large** — Buyer [U-B-03]

A photo on the buyer page is a 263 x 198 px thumbnail drawn from a 1600 x 1200 original. It is not a link or a button, and clicking does nothing.

*Why it matters:* A buyer asks for photos to judge stitching and finishing. A thumbnail cannot show that.

*Evidence:* [screenshot](audit-04/AU-03-buyer-photo-thumbnail.png). *Status:* Open.

**AU-04 (S2) A bookmark or a second tab says "This link is not valid"** — Buyer [U-B-04]

The page removes the token from the address and keeps it only in that tab. F5 in the same tab works; a bookmark, a new tab or opening the page tomorrow shows the same words as a cancelled link.

*Why it matters:* Tom will bookmark the page, see "may have expired or been cancelled" the next day, and think the factory has cut him off.

*Evidence:* [screenshot](audit-04/AU-04-link-not-valid-no-contact.png). *Status:* Open.

**AU-05 (S2) The buyer page does not say who it is from, when it was updated, or whom to ask** — Buyer [U-B-05]

The page reads "Order status / Company B": no supplier name, no contact, no "valid until". The not-valid page says "ask your contact for a new link" without naming one.

*Why it matters:* It is the only thing a stranger ever sees of the company, and trust starts there.

*Evidence:* [screenshot](audit-04/AU-04-link-not-valid-no-contact.png). *Status:* Open.

**AU-06 (S2) The default warning wording alarms without informing** — Buyer, Merchandiser [U-B-06, U-M-16]

The red default reads "Finishing is at risk of finishing late (planned for 10 Nov)." The amber one reads "needs attention to finish on time". There is no expected new date, no action and no promise of an update. A merchandiser can rewrite it, but most will accept the default.

*Why it matters:* Tom's next step is to email or phone, which is exactly what the product is meant to prevent.

*Evidence:* [screenshot](audit-04/AU-06-buyer-warning-wording.png). *Status:* Open.

### Mistakes cannot be corrected

**AU-07 (S1) A mistyped order cannot be corrected or cancelled** — Merchandiser [U-M-01]

On an order the only actions are "Add an update" and "Change the ex-factory date". The server has only three order routes: create, preview and change ex-factory (checked in the code). There is no edit of quantity, sizes, colour, PO or buyer, and no cancel or archive.

*Why it matters:* Typing 600 for 6,000, or picking the wrong buyer, is the commonest data-entry mistake. The wrong order stays on the board, in the counts, and keeps raising warnings until a developer removes it.

*Evidence:* [screenshot](audit-04/AU-07-order-page-no-edit-or-cancel.png). *Status:* Open.

**AU-08 (S2) New order accepts a date that has already passed, with no warning** — Merchandiser [U-M-03]

An ex-factory date five weeks in the past (1 Oct) created an order with every stage "Late risk" and lifted the Review count from 2 to 6. The date field in Edge is month/day/year, so 01/10 and 10/01 differ by a month swap; the only hint is the words under the field. The "this date has passed" confirmation exists when you move an existing order's date, but not on New order (checked in the code).

*Why it matters:* With AU-07 she cannot undo the order that a slip of the keyboard created.

*Evidence:* [screenshot](audit-04/AU-08-new-order-past-date.png). *Status:* Partly live.

**AU-09 (S2) Blank size rows are ignored without a word** — Merchandiser [U-M-09]

Two blank size rows were dropped and the order was created for 300 pieces instead of 6,000. The only clue is the line "Total 300 pieces".

*Why it matters:* A wrong quantity flows into the maths of every stage.

*Evidence:* described in the source report. *Status:* Open.

**AU-10 (S2) She cannot see or correct what she sent** — Supervisor [U-S-04]

After Send the screen says "35 pieces saved. Sent." and "Today so far 385". There is no list of today's entries and no undo. If she meant 350 and typed 35, she must work out for herself that she has to add 315. A too-big number is caught kindly; a wrong smaller number stays in the office's figures until a merchandiser steps in.

*Why it matters:* "I made a mistake and I am afraid to touch it again."

*Evidence:* [screenshot](audit-04/AU-10-supervisor-cannot-see-what-she-sent.png). *Status:* Open: Known earlier as FE-S-11 and left open on purpose..

**AU-11 (S2) It is easy to enter the day's total instead of the new pieces** — Supervisor [U-S-08]

The only guidance is a grey 14 px line under the field. Someone who thinks "I should say today's total" types 700 after having sent 350, and the day becomes 1,050. The system says nothing, because 700 is not "more than is left".

*Why it matters:* A whole class of mistake that costs nothing to prevent.

*Evidence:* described in the source report. *Status:* Open.

### Typed work lost, and feedback that disagrees

**AU-12 (S2) A typed number or note disappears without a word** — Supervisor [U-S-07]

She types 555 and taps "Next: B-PO-88240 · Packing": the next screen opens with an empty field. She types a Tamil note and a number, taps the back arrow: both are gone, with no warning. The Next button sits directly above Send, the same width and shape, so a thumb that misses Send loses the number.

*Why it matters:* Typing Tamil with a thumb takes effort: "I typed it and it went."

*Evidence:* [screenshot](audit-04/AU-12-draft-lost-on-back.png). *Status:* Open.

**AU-13 (S2) An old error stays on screen after the next thing succeeds** — Supervisor [U-C-03]

After a bad file ("That file is not a picture.") and then a good send, the screen says "Saved 40 pieces and a note. Sent." and still shows the red picture error above it. The stale message is still there after going offline and back online.

*Why it matters:* Two messages that disagree: she reads the error as "my send failed" while the chip says all sent.

*Evidence:* [screenshot](audit-04/AU-13-stale-error-after-send.png). *Status:* Open.

**AU-14 (S2) Review jumps to the top after one action low on the page** — Merchandiser [U-C-04]

Clicking "Mark as reviewed" on the last note scrolled the page from 2,394 px to 0 (phone: 2,651 px to 0). The confirmation is at the top and she must scroll back to find the next note.

*Why it matters:* Review is a queue, so every card costs a long scroll.

*Evidence:* described in the source report. *Status:* Open.

### Signing in and language

**AU-15 (S2) A new Tamil phone opens on the English merchandiser form** — Supervisor [U-S-01]

The first screen is English with the Merchandiser form (Email, Password). The app opens the supervisor form only if the app itself has stored Tamil; it never looks at the phone's language. Selvi must read "Supervisor" in English, tap it, then find Tamil at the bottom: five taps.

*Why it matters:* "I do not use e-mail. This is not mine."

*Evidence:* [screenshot](audit-04/AU-15-first-screen-english-merchandiser.png). *Status:* Open.

**AU-16 (S2) When you forget or mistype your sign-in, the app does not help early enough** — Supervisor, Merchandiser [U-S-02, U-M-13]

Five wrong PINs give the same sentence with no count of tries left. On the sixth she is locked for 15 minutes, and the way out (ask the merchandiser) appears only then. A correct PIN is also refused during the lock. A merchandiser has no "forgot password" at all, and a wrong password and an unknown email give the same message.

*Why it matters:* "Which was wrong, the number or the PIN? How many more tries? Why was I not told?"

*Evidence:* [screenshot](audit-04/AU-16-wrong-pin-same-message.png). *Status:* Open.

**AU-17 (S2) A phone number typed with a leading 0 gets "fill in all the places"** — Supervisor [U-S-03]

"090000 10002" is refused with the wrong message although both fields are filled. +91, dashes and spaces all work.

*Why it matters:* "I filled everything. The phone is lying."

*Evidence:* described in the source report. *Status:* Open.

**AU-18 (S2) A colleague signing in on the same phone lands on the previous person's page** — Supervisor [U-S-09]

Unit 1's supervisor signs out on a stage page and a colleague from Unit 2 signs in. The app returns her to the same address and shows an empty card, "this stage is not in your list". She must find the back arrow.

*Why it matters:* On a shared phone this is the first thing the second person sees.

*Evidence:* [screenshot](audit-04/AU-18-colleague-empty-card.png). *Status:* Open.

### Reasons for a slow day

**AU-19 (S2) Only one reason can be chosen** — Supervisor [U-S-05]

Tapping "Machine problem" and then "Not enough workers" leaves only workers selected. Real slow days have two or three causes.

*Why it matters:* The note she types has to carry what the form could not.

*Evidence:* [screenshot](audit-04/AU-19-one-reason-only.png). *Status:* In a branch: Several reasons per note, a note written from them, and Review showing them are built and tested on branches (the form review), not live..

**AU-20 (S2) "Why is it slow?" is asked even on a day on target** — Supervisor [U-S-06]

The heading is on every Update screen, including a day on plan, and all seven reasons are about problems.

*Why it matters:* "Am I being blamed? I made my pieces." A product question for supervisors.

*Evidence:* described in the source report. *Status:* Open.

### Guidance for the merchandiser

**AU-21 (S2) The two main actions on an order look like headings** — Merchandiser [U-M-04, U-C-02]

"Add an update" and "Change the ex-factory date" are collapsed white cards with a bold title and no arrow, plus or button. Opening one shifts the page a lot (layout shift 1.78, where 0.1 is already noticeable).

*Why it matters:* After seeing "red", the next thing she wants to do is hidden behind something that looks like a title.

*Evidence:* [screenshot](audit-04/AU-21-actions-look-like-headings.png). *Status:* Open.

**AU-22 (S2) A red order gives her no "what to do next"** — Merchandiser [U-M-05]

The page explains the maths but offers no suggestion or action. Nothing says whether Company B has been told, and there is no link from the order page to its warning in Review.

*Why it matters:* Her goal is to act, not to read, so she leaves the page to phone the unit. A product decision.

*Evidence:* described in the source report. *Status:* Open.

**AU-23 (S2) The reason a stage is slow is shown in Tamil only on the order page** — Merchandiser [U-M-06]

"Notes from the floor" shows the Tamil text with "Not reviewed yet". The English meaning ("Two ironing machines are broken. The mechanic will come tomorrow.") exists, but only in Review.

*Why it matters:* It is the best answer to "why is it red?" and she cannot read it where she is looking.

*Evidence:* [screenshot](audit-04/AU-23-tamil-note-untranslated.png). *Status:* Open.

**AU-24 (S2) Status words and the colour rules are never explained** — Merchandiser, Evaluator [U-M-07, U-E-04]

No tooltip, legend or help says what "At risk", "Late risk" and "No update" mean or where the 90% rule is. One row (C-PO-0502) says "No update" and also "making 800/day · on pace", which looks contradictory.

*Why it matters:* She cannot tell a buyer why something is amber, and an evaluator cannot learn the rules from the screen.

*Evidence:* described in the source report. *Status:* Open.

**AU-25 (S2) Jargon at the point of use** — Merchandiser, Evaluator [U-M-08, U-C-07, U-M-20]

"TNA template", "ex-factory", "Gap", "Projected" and "making" are unexplained on the board and on New order. The explanation of TNA exists one screen away (Setup, Templates). "Alerts (not sent: demo)", "Housekeeping" and "Pilot setup" are unclear tab names, and Alerts tells every user the system is a demo. Template names carry a unit ("Knit tee or polo, Unit 1"), so choosing one silently chooses where the work happens.

*Why it matters:* A new colleague cannot tell what to choose.

*Evidence:* described in the source report. *Status:* Open.

**AU-26 (S2) Review costs a click per item, even when the AI is 95 to 100% sure** — Merchandiser [U-M-10]

Seven notes, each needing its own "Mark as reviewed". On a phone the page is 6,528 px tall.

*Why it matters:* It is her weekly chore, and a 100% match costs the same effort as an unsure one (about 4 minutes for 7 notes).

*Evidence:* [screenshot](audit-04/AU-26-review-one-click-per-item.png). *Status:* Open.

**AU-27 (S2) "Confirm for buyer" publishes at once while smaller actions ask first, and the verbs vary** — Merchandiser [U-M-11, U-C-22]

Confirm for buyer, Approve for buyer, Mark as reviewed, Don't show, Reject and Cancel link are all decisions of the same kind. Stop account and Cancel link ask first; Confirm for buyer does not, although it shows "What Company B would read".

*Why it matters:* The most outward-facing action has the lightest safety. An owner decision (D8).

*Evidence:* described in the source report. *Status:* Open.

**AU-28 (S2) "Gap 1,508 pcs short" sits beside the ship date but is measured at the stage date** — Merchandiser [U-M-12]

The sentence says "short by 10 Nov" while the order ships 12 Nov. The Gap column next to "Ship 12 Nov" reads as the shortfall at shipping.

*Why it matters:* A merchandiser quoting that number to a buyer would be quoting the wrong date.

*Evidence:* described in the source report. *Status:* Open.

**AU-29 (S2) Which button is for a lost phone?** — Merchandiser [U-M-14]

Each person has three equal buttons: "Reset PIN", "Sign out everywhere" and "Stop account". "Sign out everywhere" is not explained and nothing says what to do when a supervisor's phone is lost. (Stop account asks first and explains well.)

*Why it matters:* A lost phone is an urgent moment, not the time to guess.

*Evidence:* described in the source report. *Status:* Open.

**AU-30 (S2) Five "Update" buttons all have the same name** — Supervisor [U-C-05]

Today has five cards, each with a button named "Update". A screen reader or voice-control user hears "Update, Update, Update, Update, Update" with no order or stage.

*Why it matters:* "Click Update" is ambiguous for voice control, and a screen reader's list of links is useless.

*Evidence:* described in the source report. *Status:* Open.

### Consistency: back, top bar, names

**AU-31 (S2) The way back and the top bar are not the same from screen to screen** — Everyone [U-C-01, U-E-03, U-M-15]

Four back styles: an underlined text link, an outlined button, an arrow-only box, and two together on the bad-order screen. Three names for home ("Order board", "Board", "the board"). No bar at all on Status, the buyer page and sign-in. The Update screen's back control differs by screen width. The menu holds only What's new, Sign out and the build label.

*Why it matters:* People look for "back" in the same place and shape every time. To a first-time user it says "assembled by different hands".

*Evidence:* [screenshot](audit-04/AU-31-back-controls-differ.png). *Status:* In a branch: One shared back link (an arrow box plus the destination's name) for the order page, New order, Status and Update is built and tested on a branch, not live. Bars on the public pages, the names, and the owner's top-bar specification are still open..

**AU-32 (S2) One thing, several names** — Merchandiser, Buyer, Supervisor [U-C-06]

"Ex-factory", "Ship", "ships" and "due" are the same date, and "ex-factory" is never explained. "pcs" and "pieces" share a row. "Done", "Finished" and "Finishing" are three different things. "Warnings", "Alerts" and "notice" mean different things with similar words. "PO" and "order" are used for the same thing.

*Why it matters:* Every new word makes a user ask whether it is a new thing. An owner decision (D6).

*Evidence:* described in the source report. *Status:* Open.

### The demo and the first impression

**AU-33 (S2) The live demo's data looks used** — Evaluator [U-E-02, U-C-09]

B-PO-88213 Finishing shows 10,004 of 12,000 pieces (83%, "Today 10,004") while its earlier stage, Stitching, has 6,800 of 12,000. The brief gives only Stitching 6,800. Confirmed by a read-only call to the live API.

*Why it matters:* A careful reviewer reads this as a data-quality bug in the engine, not a leftover test entry.

*Evidence:* [screenshot](audit-04/AU-33-demo-10004-of-12000.png). *Status:* Open.

**AU-34 (S2) The first screen does not say what the product is** — Evaluator [U-E-01, U-E-05]

A centred "Sign in" card, the role switch, the language switch and the Evaluator panel. No product name beyond the browser tab and no one-line purpose. "Use these" does not say what it fills, and on a 768 px laptop the panel starts about halfway down the card.

*Why it matters:* Meera must read the deployment note to learn what she is looking at, and she has twenty minutes.

*Evidence:* [screenshot](audit-04/AU-34-first-screen-no-explanation.png). *Status:* Open.

### Polish (S3)

| Id | What | Who | Source | Status |
| --- | --- | --- | --- | --- |
| AU-35 | Five cards on Today, the ones she works on are not first, and the ring ("1 / 5") can never reach 5 on a normal day (known earlier as FE-S-04) | Supervisor | U-S-10 | Open |
| AU-36 | Photo is camera-only (no gallery) and a bad-file error sits under the fixed bottom bar; a 3.2 MB photo is shrunk to 113 KB, which is good | Supervisor | U-S-11 | Open |
| AU-37 | After a send the bottom bar takes about 210 of 844 px and the old "saved" line stays while she types the next number | Supervisor | U-S-12 | Open |
| AU-38 | Tamil digits (௩௫௦) are refused with a generic message | Supervisor | U-S-13 | Open |
| AU-39 | Small trust and format gaps: "All sent" carries no time; "1508 pcs short" beside "1,508 pcs short" on one row; "2415" beside "2,415"; times in three styles; the disabled Send is grey on grey | Supervisor, Merchandiser | U-S-14, U-C-20, U-C-21 | Open |
| AU-40 | Tamil wording for supervisors to confirm ("கெடு" for Due also means a threat, "பதிவு செய்" is a command, "விவரங்கள் தவறு" is blunt); draft Tamil looks the same as reviewed Tamil; Tamil screens carry English order data | Supervisor | U-S-15, U-C-18, U-C-19 | Open |
| AU-41 | Demo-only things nothing explains: "Updated 2:12 AM · Today 6 Nov" mixes the real clock with the fixed demo day; the Evaluator panel is on the sign-in page | Supervisor, Evaluator | U-S-16, U-E-08 | Open |
| AU-42 | One date change writes six near-identical history rows with the same reason | Merchandiser | U-M-17 | Open |
| AU-43 | At 1366 x 768 only 2 of 7 orders show without scrolling (tiles and toolbar take about 370 px) | Merchandiser | U-M-18 | Open |
| AU-44 | A finished stage carries the stamp "ON TRACK" in the timeline and stage cards, so a completed stage reads as on track, not Done | Merchandiser | U-M-19 | Open |
| AU-45 | No way to copy last season's order or paste sizes from Excel; the date input follows the browser (month/day/year in Edge) | Merchandiser | U-M-21, U-M-22 | Open |
| AU-46 | Spell-check is on in every field, including PO numbers, quantities and the Tamil note, so red wavy underlines appear under words Edge does not know (a probable cause of the click-animation report) | Everyone | U-C-10 | Open |
| AU-47 | Page width and alignment change between tabs (board 1,200 px, Review, Setup and New order 880 px, Status 560 px) | Merchandiser | U-C-11 | Open |
| AU-48 | The same status appears three times on the order page (header, timeline, stage card) and in two letter cases (upper-case stamps, sentence-case tiles) | Merchandiser | U-C-12 | Open |
| AU-49 | 404 and bad-order screens are thin: one sentence and a button; the bad-order screen shows a text link and a button together | Everyone | U-C-13 | Open |
| AU-50 | Feedback gaps: "Mark as reviewed" works with nothing decided; disabled Sign in and Send give no reason; the number error shows only after leaving the field, and "99999999" gets the "whole numbers" message | Supervisor, Merchandiser | U-C-14, U-C-15, U-E-07 | Open |
| AU-51 | Keyboard shortcuts (G then R) exist only in tooltips; the menu has no help or "how to read this board" | Merchandiser, Evaluator | U-C-16, U-E-06 | Open |
| AU-52 | With the AI off, the helper sentence repeats on every note (seen on the private copy; on the live app the AI is on) | Merchandiser | U-C-17 | Open |
| AU-53 | "Review 2" is read out as "Review 2 2 waiting"; the sign-out-with-updates-waiting warning is wordy | Everyone | U-C-23, U-C-24 | Open |

## 5. What works well

This is half the truth, so it is specific.

- **Speed to the first send.** Sign-in is 5 taps and about 5 seconds; a count is 3 taps and 1.3 seconds; the number field is focused on arrival with a numeric keypad; buttons and fields are 56 px, everything else 48 px or more ([offline picture](audit-04/WW-offline-chip-feels-safe.png)).
- **No signal feels safe.** "No connection", then "1 waiting", then "200 pieces saved, 1 waiting to send". Today-so-far still counts queued pieces, reloading offline keeps everything, a queued update survived closing the tab, and the chip said all sent 0.5 s after the signal returned. Double-tapping Send counts once (1,282 to 1,382, not 1,482). A 3.2 MB camera photo is shrunk to 113 KB and a count with it is "all sent" in 4.0 s on emulated Slow 3G.
- **Kind handling of mistakes the system can see.** A count that is more than what is left is met with a polite question, and the button becomes "send 99999 anyway". Signing out with updates waiting warns first, and the sign-in screen then says how many wait. A date beyond two years is refused with a clear message.
- **Tamil where the supervisor looks.** The only Latin text on the Tamil screens is order data (style, colour, PO), the language name and the build label. The smallest text is 14 px and the lowest contrast is 4.7:1.
- **The board answers "what is in trouble?" in 2 seconds** ([board](audit-04/WW-board-at-a-glance.png)): tiles with counts and "pcs short", worst first, status as icon plus word (readable in greyscale), a progress bar in pieces, search that finds colour, filters in the address, and numbers that agree on the board, tiles, order page, stage cards and timeline (1,508 + 270 = 1,778).
- **Review is the best-explained screen** ([Review](audit-04/WW-review-tamil-beside-english.png)). The Tamil original sits beside the English meaning, the AI shows its reasoning ("AI is not sure (40%). It might be 'Something else'. Please check the reason yourself"), it says when the AI disagrees with the supervisor, and it states that nothing is visible to a buyer until confirmed.
- **Care with risky actions.** Stop account, Sign out everywhere, Delete template, Back to normal and Cancel link all ask first, name what will happen and focus the safe button. A new buyer link is shown once with a Copy button. Date changes require a reason and say "5 stage dates moved with it". A duplicate PO is refused in plain words.
- **Buyer isolation held.** Company B's page lists exactly its four POs and Company C's exactly its three, with no reference to the other anywhere in the page, the file or the API. The confirmation gate worked: a warning and a photo reached the buyer only after a merchandiser confirmed them. The weekly file opens in Excel (BOM, ISO dates, plain integers).
- **Keyboard and focus.** The skip link is the first stop on every screen, every stop shows a visible focus ring, a failed form moves focus to the error summary, Escape closes every dialog.
- **Empty and error states say what to do.** "No orders match 'zzzz-nothing'. Check the spelling, or search for less", "This link is not valid. It may have expired or been cancelled".
- **Speed and polish.** Sign-in is ready in 0.6 s; the buyer page in 0.7 to 1.2 s; no sideways scroll or console error was found on any screen.

Already fixed by the earlier bug cycle and confirmed by the auditors: the over-quantity question, 0 pieces, the sign-out warning, the date-change range with a confirmation (on Change date), Tamil stage names, no scrolling sideways.

## 6. The "animation when I click on any text" report

**What was measured.** 32 clicks on plain text and controls (titles, table cells, labels, stamps, tiles, headings, help text, the number field, reason chips, the progress ring, the sync chip, the buyer cards) with a mouse on desktop and with touch on the phone, recording running animations, layout shifts, scroll jumps, focus, outline and selection at 20, 120, 350 and 800 ms after each click.

**Result.** No animation or transition runs on a click of text anywhere. The only animations in the app are the loading ring, the skeleton, the progress ring when its figures change, the first-paint ring and the sync-chip pulse, and none is started by a click. No layout shift or scroll jump either, except by design when a collapsed card opens (AU-21).

**Likely causes, in order** (an inference: the auditors could not see the owner's screen).

1. **Edge's caret browsing (the F7 setting).** With it on, a blinking text cursor appears in any text you click. This reproduced the report exactly ([picture](audit-04/AU-46-caret-browsing-text-cursor.png)). Press F7: if Edge asks to turn caret browsing on, it is off, and pressing it again toggles it.
2. **Spell-check underlines (AU-46).** Spell-check is on in every field, so red wavy lines appear under PO numbers, names and Tamil words when a field is clicked or typed in.
3. The blinking cursor of a focused field.

**One question for the owner:** does it also happen on other websites, and on which screen and device? If it does, it is caret browsing and nothing in the app needs to change.

## 7. Open questions for the owner

1. **What may a buyer see?** Today: planned dates and confirmed notices. The brief says buyers should "see progress". Options in the plan (D1): add a notice line, last-updated time and Done / In progress / Not started per stage.
1. **Date changes.** The brief says buyers' compliance teams want a history of every date change. Should the buyer see the reason, or only the old date, the new date and when (D3)?
1. **Who is the contact on the buyer page** (D2)?
1. **Should a merchandiser be able to edit or cancel an order** (D4)? If a typo should go through an administrator instead, say so on screen.
1. **Should a supervisor be allowed to correct her own last entry** (D5), and for how long?
1. **Which word is the product's own for the ship date** (D6): "ship date", "ex-factory" or "due"?
1. **The top bar.** You said you uploaded a markdown file for the top bar. It could not be found on this computer (searched the project, Downloads, Desktop and Documents). Please paste its contents or give the path (D7).
1. **Should "Confirm for buyer" ask first** (D8)?
1. **Should "Why is it slow?" appear only when a stage is behind plan?** Ask three supervisors which feels fairer.
1. **Photos.** Is a photo taken earlier (from the gallery) acceptable, or must it be taken now?
1. **Is the live demo meant to look "used" or "fresh"?** The 10,004 entry suggests earlier use; a daily reset of events would give every reviewer the same first impression.
1. **The click animation:** does it also happen on other websites?

## 8. Not checked

A real cheap phone, glare in real sunlight (contrast was measured, not seen), an iPhone, TalkBack or any screen reader, voice typing in Tamil, a long real session on a real mobile network, an email client opening the buyer's link, Excel itself (the file was inspected as bytes), an expired link by time (only a cancelled one), supervisors' and buyers' own reactions, whether the Tamil reads naturally, a true first run on an empty database, dark mode and the form review (both are on branches, not in `main`), and offline use on the live app.

