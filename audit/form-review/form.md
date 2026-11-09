# Form review, phone Update form: evaluation and chosen pattern (stream FORM, 10 Nov 2026)

## What the form did before
- Reasons: seven chips behind a radio group, with a click handler that made a second tap clear the choice. One reason at most.
- Note: an empty box the supervisor always typed into, whatever they had tapped.
- Sent: `note: { text, category }`, one reason. The server, Review and the AI all read one `category`.
- After Send: "Saved 350 pieces with a note."

## Pattern chosen
1. **Chips are checkboxes.** A tap switches only that reason. The order of the taps is kept (it is the order of the sentence, and the first tapped is the main reason). The selected look is the action colour plus a check mark. A quiet "2 selected" line appears when some are chosen. The class names the narrow-screen rules use are unchanged.
2. **The note writes itself, and stays the person's.** While the note is only what the choices would write, it follows them. The first time the person changes the text it becomes theirs: later taps never touch it. A small link, "Rewrite from my choices", writes it again on request only. Clearing the box leaves it empty and does not refill it while they type; the next tap writes from the choices again. Putting the sentence back by hand makes it generated again. "Something else" writes its general sentence and asks for a few words, without blocking Send.
3. **Language.** The sentence is written in the language of the phone: Tamil for a supervisor on a Tamil phone (a DRAFT, listed in `audit/TAMIL-REVIEW.md`), English otherwise. Several reasons in Tamil are joined as a list of the chip labels, so no combination needs its own grammar.
4. **Submission.** `{ text, category: first tapped, categories: [all, in order] }`. An update queued by an older build (one `category`, no list) still sends exactly as before. The server decides itself whether the text is the generated one; the phone never sends a flag.
5. **The line after Send** says what was contributed: "Saved: 350 pieces added to today, with a photo and a note." A day with no output says "Saved: no output reported today".

## Why this and not something else
- A free-text box that is silently rewritten loses people's words; a box that is never written for them keeps the typing. The `edited` flag is the smallest rule that does neither.
- Checkboxes, not custom toggles: the keyboard, the screen reader and the browser's grouping come free, and the tap size stays 48 px.
- `category` stays the first reason so Review, the AI and the buyer export keep working unchanged.
