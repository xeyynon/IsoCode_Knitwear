# Interface snapshots

> **Frozen record: UI/UX 1.0**, the app as of build 1006 (3 Nov 2026), kept to compare with 2.0. Do not regenerate or edit the pictures. The command below now writes the 2.0 set (../2.0), not this folder.

Pictures of every screen as it looks now, taken from the running app on demo data (not real orders). Regenerate them any time the interface changes:

```bash
npm run dev:api                  # terminal 1
npm run dev -w @isocode/web      # terminal 2
npm run snapshots                # terminal 3: rewrites this folder
```

Last taken: 2026-11-03. 31 pictures.

## Desktop

### Sign in
Merchandiser sign-in. A switch at the top changes to the supervisor form (phone number and PIN).

![Sign in](01-login-desktop.png)

### Sign in: wrong password
A plain message. The password is cleared and the cursor goes back to it. The same message is shown whether the account exists or not.

![Sign in: wrong password](02-login-wrong-password.png)

### Order board
Every order, worst first. The counts at the top are filters. Under each order is the working behind its colour. Only the red row is tinted; every status also has an icon and a word.

![Order board](03-board-desktop.png)

### Order board: filtered to late risk
The filter is kept in the web address, so a reload or a shared link keeps it.

![Order board: filtered to late risk](04-board-filtered-red.png)

### App menu
Language and sign out live in one menu. Esc closes it and returns focus to the button.

![App menu](05-board-menu-open.png)

### Order board in greyscale
The check that status never depends on colour alone: the late-risk row still reads from its triangle and its words.

![Order board in greyscale](06-board-greyscale.png)

### Order board in Tamil
The four status words in Tamil (taken from the design notes; not yet checked with supervisors). Anything not yet translated stays in English rather than guessing.

![Order board in Tamil](07-board-tamil.png)

### System status
Public page with no sign-in: plain Up or Down for the API and the database, nothing about how it is built.

![System status](08-status-page.png)

### New order
Buyer, PO, style, colour, quantity by size (S, M, L and XL are already named; a size left blank is simply not ordered), ex-factory date and a TNA template.

![New order](17-order-form-empty.png)

### New order: everything that is missing
Pressing Create with gaps lists every problem in plain words at the top and marks each field. Nothing is sent.

![New order: everything that is missing](18-order-form-errors.png)

### New order: the dates it would get
As soon as there is a template and a date, the form shows when each stage must finish, worked backwards from ex-factory (Sundays and closures skipped), before anything is created.

![New order: the dates it would get](19-order-form-preview.png)

### New order: already late
If a stage would already be due, the form says so. The order can still be created and will show as late on the board; it is not refused.

![New order: already late](20-order-form-late.png)

### Order detail
Each stage with the planned finish date beside the projected one, how far apart they are, the progress, and the working behind the colour. Ex-factory can be changed here; a reason is required and is kept in the history.

![Order detail](21-order-detail.png)

### Review queue
Nothing reaches a buyer until a merchandiser confirms it. Each warning shows the wording the buyer would read (editable) and, in grey, the figures behind it that only the factory sees. "Do not show" hides it from buyers.

![Review queue](24-review-queue.png)

### Setup: people
Who can sign in, and what the merchandiser can do about it: reset a PIN, sign someone out on every phone (a lost phone), or stop an account (a leaver). Easy PINs such as 1234 and 1111 are refused. Phone numbers show only their last four digits.

![Setup: people](29-setup-people.png)

### Setup: closed days
Sundays are closed by default. Add a holiday such as Deepavali or an extra day worked, for one unit at a time, so a subcontractor can close on different days. The board uses the new working days at once.

![Setup: closed days](30-setup-closed-days.png)

### Setup: a template, with a mistake explained
Stages are listed in the order they happen, each with the working days before ex-factory and the unit that does it. If a later stage would finish before an earlier one, it says so in plain words and the Save button stays off. Nothing is saved from this picture.

![Setup: a template, with a mistake explained](31-setup-template-editor.png)

## Phone

### Order board on a phone
Each order becomes a card. The sentence behind the colour stays under the PO number.

![Order board on a phone](09-board-phone.png)

### Supervisor sign-in
Phone number and a 4-digit PIN. The supervisor stays signed in on their own phone.

![Supervisor sign-in](10-login-supervisor-phone.png)

### My orders today
Only this supervisor's own unit. Large buttons, numbers first, soonest due first. The chip at the top says All sent.

![My orders today](11-today-list-phone.png)

### My orders today in Tamil
Only the title and the sync chip are in Tamil so far; stage names, labels and buttons are still English. Untranslated text is left in English rather than guessed. The Tamil that is here is unreviewed and must be corrected by supervisors, and the rest still has to be written, before the pilot.

![My orders today in Tamil](12-today-list-tamil-phone.png)

### Daily update
One number, one big button. "Today so far" and "Left" show the effect before anything is sent.

![Daily update](13-update-empty-phone.png)

### Daily update: a number larger than what is left
A likely typing slip, so the button changes to "Send 99999 anyway" and asks once. Nothing was sent.

![Daily update: a number larger than what is left](14-update-confirm-too-many.png)

### Daily update with no signal
The number is saved on the phone first. The chip says Offline and how many are waiting. It never says sent until the server has confirmed it.

![Daily update with no signal](15-update-offline-saved.png)

### My orders today with an update waiting
Today so far already includes the waiting 120 pieces, so the supervisor sees the effect straight away.

![My orders today with an update waiting](16-today-offline-waiting-phone.png)

### Order detail on a phone
The same page on a narrow screen: stacked, no sideways scrolling.

![Order detail on a phone](22-order-detail-phone.png)

### New order on a phone
The order form on a narrow screen.

![New order on a phone](23-order-form-phone.png)

### What a buyer sees
A read-only page opened from a private link, with no sign-in. Only this buyer's orders and planned dates, and only warnings a merchandiser has confirmed. No colours, rates, shortfalls or other buyers. The link's secret is removed from the address bar as soon as the page loads.

![What a buyer sees](25-buyer-view-phone.png)

### A link that does not work
A missing, unknown, cancelled or expired link all show this same message, so nothing tells an outsider which case it was.

![A link that does not work](26-buyer-link-not-valid.png)

### Daily update with a photo
Tap Add a photo to use the camera. The photo is shrunk on the phone (a large camera picture becomes roughly 150 KB) and its size is shown, so it sends quickly even on a weak signal. It is saved with the update and uploaded when there is signal. Nothing here has been sent.

![Daily update with a photo](27-update-photo-ready-phone.png)

### Daily update: a reason and a note, in Tamil
Why is it slow? is a short list of big buttons, so the usual cause is one tap. The note is optional free text typed in Tamil or English. The reason words come from a list the factory controls; the Tamil here is unreviewed and must be corrected by supervisors. Nothing has been sent.

![Daily update: a reason and a note, in Tamil](28-update-reason-note-tamil-phone.png)

