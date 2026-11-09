# Form review, stream SRV: several reasons per note, and a note written from them

Database and server only. Nothing under `packages/web` was touched.

## Contract (final)

**Phone to server** (`POST /api/events`, and the same `note` object in a batch / visit entry):

```json
{ "note": { "text": "optional string", "category": "optional id", "categories": ["machine", "labour", "material"] } }
```

- `categories`: the reasons in the order tapped. Distinct, each an id on the settings list `reason_categories`, at most 7. A bad list is **400** (`bad_request`, the app's error shape) and nothing is written (no update, no note): not an array, an item that is not text, an id not on the list, a repeat, more than 7.
- `category` sent with `categories` must equal `categories[0]`, else 400. With a list present, `category` is `categories[0]`.
- `category` alone (an older phone) behaves as before, including filing an id that has left the list as `other`; the note then has a one-item list.
- `generated` in the input is **ignored**. The server decides.
- Reasons alone (no text) are still a note; no reasons and no text is still no note.

**Generated (decided by the server).** `generated` is true only when all hold: `categories` was sent, `text` is non-empty, and `text` equals `composeReasonNote(language, categories)` exactly (language detected from the text, order as sent). A generated note:
- gets its English meaning at once (`text_en` = the English sentence; a Tamil note keeps `text_ta` as its original beside it);
- records the supervisor's own choice in the suggestion columns: `ai_status = 'suggested'`, `ai_model = 'supervisor-choice'`, `ai_category` = main reason, `confidence = 1`, `ai_text_en` = the English sentence, `ai_attempts = 0`;
- is never claimed for the AI (the claim query only takes `ai_status is null` or `failed`), so no call is made and the day's `ai_budget` is not used.
Typed or edited text is not generated and goes through the AI exactly as before.

**Review API** (`GET /api/review` notes, and `notes` on `GET /api/orders/:id`, `ReviewNote`): two new fields on every note.

```json
{ "category": "machine", "categoryBy": "supervisor", "categories": ["machine", "labour"], "generated": false, "ai": null }
```

`categories` is `[]` when no reason, a one-item list for an older note (derived from `category`, and the migration backfills it). `generated` is a boolean. Buyers still get no notes at all (a test checks the buyer JSON for `categories` / `generated`). The CSV export is unchanged.

**Merchandiser settles the reason** (`POST /api/notes/:id/confirm`, `{ "category": id }`, unchanged call): the chosen reason becomes the main reason.
- one of the supervisor's tapped reasons: it moves to the front and the others stay (`[a,b,c]` + `c` -> `[c,a,b]`), `category_by = merchandiser`, `generated = false`;
- a reason the supervisor did not tap: the list becomes just that reason, `generated = false`;
- the same main reason (or none sent): nothing changes, a generated note stays generated.

## Migration `021_note_reasons.sql`

- `note.categories text[] not null default '{}'`, `note.generated boolean not null default false`.
- Data step as the system role (RLS is forced for the owner, as 014/016/020 do): `categories = array[category]` where `category is not null`.
- `note_categories_ok` check: at most 7 items, and when the list is not empty it starts with `category` (and `category` is not null).
- `sup_note_write` (insert policy, supervisors) replaced: same as 016 plus exactly one widening, either `generated = false and ai_status is null`, or a generated row of the supervisor-choice shape (`ai_status = 'suggested'`, `ai_model = 'supervisor-choice'`, `confidence = 1`, `ai_category = category`, `ai_attempts = 0`). A supervisor session therefore cannot write any other use of `generated` or of the suggestion columns, still cannot confirm a note or mark the reason as chosen by a merchandiser. The sentence itself cannot be checked in SQL; the server checks it before writing.
- Each migration runs in its own transaction (runner), so a failure applies nothing.

## Tests (`packages/server/test/bugfixFormReasons.test.ts`, 31)

BE-083 (5): reasons stored in order tapped, main reason first; an older phone's single `category`; reasons alone and empty list; `category` equal to the first of the list; backfilled rows.
BE-084 (7): six refusals (id not on the list, repeat, more than 7, not a list, item not text, `category` not the first) each writing nothing, and a single stale `category` still filed as `other`.
BE-085 (6): generated in English and in Tamil (English meaning beside the Tamil original); marked as the supervisor's choice; edited or added-to text is not generated and stays for the AI; a `generated` field from the phone is ignored; right words in the wrong order, or the sentence for other reasons, is not generated.
BE-086 (2): a generated note is skipped by the suggestion run and the AI budget stays untouched; typed text still reaches the AI.
BE-087 (3): `categories` and `generated` on review notes (new and old rows, a row with a main reason and an empty list reads as a one-item list); a buyer sees no note, `categories` or `generated`.
BE-088 (3): settling the reason (front, replace, same).
BE-089 (5): a supervisor session cannot forge `generated`, an AI-looking suggestion, confirmation or "chosen by a merchandiser", or a list that disagrees with the main reason or is longer than 7.

## Mutation checks (each broken on purpose, then restored byte for byte)

1. Trust the phone's `generated` flag -> 1 test failed (BE-085 "the phone cannot say a note is generated").
2. Accept an id that is not on the list -> 1 failed (BE-084 "an id that is not on the list").
3. Leave a generated note for the AI (`ai_status` not set) -> 7 failed (BE-085 and BE-086).

## Not done / not verified

- The whole `npm run verify` was started but its result could not be read: the machine's C: drive filled up (0 MB free) during the run, which stopped the command output from being written. The new test file passes (31 of 31) and the three mutation checks ran before that. Run `npm run verify` again once space is freed.
- Not run against a real Postgres (`npm run test:pg`): the migration and policy are exercised on PGlite only.
- `packages/web` types for the review note (`categories`, `generated`) are for stream REV.
- The private `md/api.md` was not edited (not in the repository).

## Files

New: `packages/server/db/migrations/021_note_reasons.sql`, `packages/server/test/bugfixFormReasons.test.ts`, `audit/form-review/srv.md`.
Changed: `packages/server/src/noteService.ts` (parse, insert, review shape, settle rule).
