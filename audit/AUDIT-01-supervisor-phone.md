# UI/UX audit 01: supervisor journey (sign-in, My orders today, Update, menu), 2026-11-08

Person and device audited: supervisor, 390x844 viewport in desktop Chrome 157 (no real touch, no real phone)
Build: 1006 (branch `frontend-audit`, uncommitted changes present)    Data: demo (in-memory, today fixed to 4 Nov 2026)

## Evidence
Screenshots in `audit/`: 02 Today (en), 03 Update (en), 04 and 05 too-many-pieces (en), 06 Today (ta), 07 Update (ta), 08 menu (ta), 09 and 10 sign-in (ta).
Measured in the page: horizontal overflow (none at 390), `h1` count (1 on every screen), target sizes, font size and line height, input attributes, console (0 errors or warnings).

## Findings (most serious first)

1. **Send is below the fold; the keyboard makes it worse** (S2)
   Where: `/today/:orderId/:stage`, `pages/Update.tsx`.   Who it hurts: supervisor.
   What I saw: at 844 px tall the page is about 1045 px (English) and 1200 px (Tamil). After typing the pieces, the next thing on screen is seven reason pills, the note box and the photo button; Send is last. With the keyboard open on a real phone the visible area is about half of that.
   Why it matters: the product promise is "3 taps after typing" and "numbers first". The count is the one required thing, and its button is the furthest from it.
   Fix: keep the number field and a full-width Send in a sticky bottom bar (reason, note and photo stay in the scroll area above it). Keep the confirm banner next to Send.
   Effort: M.   Test that proves it: Playwright check that Send's bottom edge is inside the viewport with the number field focused; a source guard that the sticky bar class exists.

2. **A Tamil-reading supervisor opens sign-in on the merchandiser form** (S2)
   Where: `/login`, `pages/Login.tsx`.
   What I saw: with the language already Tamil, the Merchandiser tab is selected and shows English "Email" and "Password" labels. The supervisor has to find and tap "மேற்பார்வையாளர்" first. Autofocus then puts the cursor in the email field, so on a phone the keyboard opens over the wrong form.
   Why it matters: rule 14 (Tamil first) and the "3 taps" promise start at sign-in.
   Fix: remember the last role used on this phone (and default to Supervisor when the language is Tamil); do not autofocus on a touch device until the role is chosen.
   Effort: S.   Test: pure rule in `langRules.ts` style (role default from language and last role).

3. **The language switch on sign-in is a 22 px high text link on a mouse** (S4, corrected after reading `styles.css`)
   Where: `/login` ("English" link, 48 x 22 px as measured here with a fine pointer).
   Correction: `styles.css` ends with a `@media (pointer: coarse)` rule that raises `.link`, `.back` and `.po-link` to 44 px, so on a real phone this is already fine. I could not see that in this browser because resizing the window does not turn on touch.
   Remaining point: it is the only way to change language before signing in, and a visible pair (தமிழ் / English) would be clearer than one small link. Effort: S.

4. **Back link is 24 px high on a mouse** (S4, corrected)
   Same correction as 3: the coarse-pointer rule covers `.back`. Nothing to fix for touch; verify on a real phone.

5. **Disabled Send and Sign in look broken** (S3)
   Where: Update and Login. `opacity: .55` on indigo gives a washed-out lavender. The only hint is the grey helper text above. Already listed in the front-end guide, section 8.8.
   Fix: a clear disabled treatment (grey fill, ink text) plus a one-line reason under the button when the cause is "no number yet".

6. **The too-many warning is far from the field it is about** (S3)
   Where: Update after the first Send tap. The banner sits above Send, the number field shows no error state, and the field is off screen on a phone.
   Fix: mark the field (`aria-invalid`, border) and bring the banner into view next to it, or put the banner inside the sticky bar from finding 1.

7. **No focus on arrival at Update** (S3 or S4)
   `document.activeElement` is `BODY`. One extra tap opens the keypad. Autofocus on the number field would save it, but pops the keyboard before the supervisor has read the card, so decide with supervisors.

8. **Sign-in inputs are 44 px, Update's number field is 56 px** (S4)
   The supervisor phone and PIN fields are the first thing used each day. Consider 56 px to match the rule for supervisor number fields.

9. **Cosmetic**: the note box shows a resize grip on a phone; the Tamil app-bar title ("இன்றைய ஆர்டர்கள்") wraps to two lines and the bar grows (allowed by the rules, but worth a look at the real phone); a left-over desktop scrollbar appears once the page is long (not a phone issue).

## Passed checks
- No sideways scroll at 390 px; one `h1` per screen; console clean.
- Tamil: Noto Sans Tamil, 18 px, line height 1.6, nothing truncated, long labels wrap. No English left on Today or Update apart from data (`tee · navy`).
- Bad numbers are refused in words ("-5": "Only whole numbers, like 350. Check the number.") and the Send button stays off.
- Too many pieces asks once and the button becomes "Send 99999 anyway".
- Reason pills are 48 px tall, real radio inputs, correct group. Number keypad opens (`inputmode=numeric`, `pattern`). PIN is a numeric one-time-code field limited to 4.
- Language switch and Sign out are in one menu, 44 px each; focus lands on the first item when it opens.
- Language and Tamil choice survive sign-out.

## Not checked (needs a real phone, a real person, or something I could not drive)
- Real touch: coarse-pointer sizes, keyboard covering the page, the camera and photo rotation, a Tamil keyboard.
- Offline: queueing, "3 waiting", reload with no signal (needs the production build; `npm run e2e` covers the queue).
- Sending a real update (I did not send one, to keep the demo data clean).
- Slow 3G and a 2 GB phone.
- Whether the Tamil wording is right: only supervisors can say. Words I would ask about first: "கெடு" for Due, "இதுவரை" for so far, "பதிவு செய்" for Update.

## Recommended order of work
1. Sticky Send bar (finding 1).
2. Sign-in role and language (2 and 3).
3. Touch target and disabled-state pass (3, 4, 5, 8) in one CSS change.
4. Too-many warning placement (6).
