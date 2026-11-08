# Tamil to be read and corrected by supervisors

Decision D1 (8 Nov 2026): new words on supervisor screens get **draft Tamil, written by the front-end session and unreviewed**, kept in this one list for the pilot review. The same applies to all the Tamil that existed before (`packages/web/src/i18n.ts`, the `ta` block); this list holds only what UI/UX 2.0 added, so the supervisors can see what is new. Nobody who reads Tamil has checked any of it yet.

How to review: show the screen (or the line below) to three supervisors; ask what they understand it to mean and what word they would use on the floor; write their wording and the date in the last column; then change the string in `i18n.ts` and delete the "DRAFT" comment beside it.

| Key | Where it appears | English | Draft Tamil | What to check | Reviewed (who, date, wording) |
| --- | --- | --- | --- | --- | --- |
| `today.progress` | My orders today, a line under the sync chip | `{n} of {m} updated today` | `இன்று {m} இல் {n} பதிவு செய்யப்பட்டது` | The number order: "m இல் n" reads "n out of m". Is "பதிவு செய்யப்பட்டது" (was recorded) the word supervisors use for entering the day's count? | |
| `today.countsFor` | The same line, after a dot | `Counts go to {date}` | `{date} தேதிக்கான எண்ணிக்கை` | Does "எண்ணிக்கை" (count) read as the pieces they type? Does it make clear the count goes to that date, not the phone's date? | |
| `update.next` | After a send, a button above Send | `Next: {po} · {stage}` | `அடுத்தது: {po} · {stage}` | "அடுத்தது" (the next one): is it clear this opens the next stage that has no update today? | |
| `today.nothingNext` | My orders today, under "Nothing to update right now" when the list is empty | `New orders appear here when your merchandiser sets them up.` | `புதிய ஆர்டர்களை மெர்ச்சண்டைசர் சேர்த்ததும் அவை இங்கே தெரியும்.` | Is it clear whose job it is to add orders, and that the supervisor does nothing? Is "மெர்ச்சண்டைசர்" what the floor says? | |
| `common.skip` | The first link on every screen, shown only when a person tabs to it | `Skip to main content` | `முதன்மைப் பகுதிக்குச் செல்` | Is "முதன்மைப் பகுதி" (the main part) understood as "the screen's content, not the menu"? | |
| `err.notFoundTitle` | The title of the screen for an address that does not exist (a mistyped or old link) | `Page not found` | `பக்கம் இல்லை` | Plain enough as a title? | |
| `err.notFound` | The same screen, the sentence | `That page does not exist.` | `அந்தப் பக்கம் இல்லை.` | Does it read as "this address is wrong", not "the app is broken"? | |
| `err.notFoundBack` | The same screen, the button | `Back to today's orders` | `இன்றைய ஆர்டர்களுக்குத் திரும்பு` | "திரும்பு" (go back): does the button clearly lead to the list? | |

Existing Tamil that the first audit already flagged for review (words to ask about first): "கெடு" for Due, "இதுவரை" for so far, "பதிவு செய்" for Update.
