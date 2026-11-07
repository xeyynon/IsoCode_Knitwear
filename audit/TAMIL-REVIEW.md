# Tamil to be read and corrected by supervisors

Decision D1 (8 Nov 2026): new words on supervisor screens get **draft Tamil, written by the front-end session and unreviewed**, kept in this one list for the pilot review. The same applies to all the Tamil that existed before (`packages/web/src/i18n.ts`, the `ta` block); this list holds only what UI/UX 2.0 added, so the supervisors can see what is new. Nobody who reads Tamil has checked any of it yet.

How to review: show the screen (or the line below) to three supervisors; ask what they understand it to mean and what word they would use on the floor; write their wording and the date in the last column; then change the string in `i18n.ts` and delete the "DRAFT" comment beside it.

| Key | Where it appears | English | Draft Tamil | What to check | Reviewed (who, date, wording) |
| --- | --- | --- | --- | --- | --- |
| `today.progress` | My orders today, a line under the sync chip | `{n} of {m} updated today` | `இன்று {m} இல் {n} பதிவு செய்யப்பட்டது` | The number order: "m இல் n" reads "n out of m". Is "பதிவு செய்யப்பட்டது" (was recorded) the word supervisors use for entering the day's count? | |
| `today.countsFor` | The same line, after a dot | `Counts go to {date}` | `{date} தேதிக்கான எண்ணிக்கை` | Does "எண்ணிக்கை" (count) read as the pieces they type? Does it make clear the count goes to that date, not the phone's date? | |
| `update.next` | After a send, a button above Send | `Next: {po} · {stage}` | `அடுத்தது: {po} · {stage}` | "அடுத்தது" (the next one): is it clear this opens the next stage that has no update today? | |
| `today.nothingNext` | My orders today, under "Nothing to update right now" when the list is empty | `New orders appear here when your merchandiser sets them up.` | `புதிய ஆர்டர்களை மெர்ச்சண்டைசர் சேர்த்ததும் அவை இங்கே தெரியும்.` | Is it clear whose job it is to add orders, and that the supervisor does nothing? Is "மெர்ச்சண்டைசர்" what the floor says? | |

Existing Tamil that the first audit already flagged for review (words to ask about first): "கெடு" for Due, "இதுவரை" for so far, "பதிவு செய்" for Update.
