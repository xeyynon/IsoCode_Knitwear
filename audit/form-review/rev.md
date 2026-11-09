# Form review, Review screen: several reasons on one note (stream REV)

Written 10 November 2026. Branch `form-rev`, from `form-base` (b1f0476). Merchandiser screens are English only.

## 1. How a note shows today (evaluation)

A note in the Review queue shows: the order line, the supervisor's original words (Tamil or English) with a language tag, an AI box (waiting, suggested "AI suggests X (90% sure)", unsure "AI is not sure (40%)...", failed, or off), an English meaning box for a Tamil note (starting as the AI draft), a single **Reason** picker (pre-filled with the supervisor's tap, then a sure AI suggestion, never an unsure one), and "Mark as reviewed". It assumed ONE reason per note. With several reasons tapped, nothing in the queue would show them, a note written from the choices would still be sent to the AI and could show "not sure", and the AI could "disagree" with a reason the supervisor had in fact tapped.

## 2. The pattern

- **A plain list of the reasons, in the order tapped** (new molecule `ui/molecules/ReasonList`): neutral outlined chips that are not buttons; the first says **Main reason** in words, so neither the order nor the main one relies on colour. No fill, no tint, no edge bar, tokens only.
- **The control that changes the reason changes only the main one.** With several reasons its label is "Main reason" and a line says the others stay as the supervisor chose them. Picking another main reason moves it to the front of the list; nothing is dropped (`reasonsShown`). It is still sent to the server as `category`.
- **A note written from the choices** (`generated: true`, with at least one reason): says quietly "Written from the supervisor's choices", is never asked about (`waitingForAi` is false), shows no AI line at all (so "Asking AI" and "not sure" can never appear), has no "AI draft" wording, and its English box starts as the composed English sentence (`generatedMeaning`: the server's own `textEn` if it sends one, else `composeReasonNote('en', reasons)`), still editable.
- **An edited or typed note** (`generated` not true) keeps today's AI flow exactly. The AI "disagrees" with the supervisor only when its reason is none of the ones they tapped.
- **An old note** without `categories` renders exactly as before: no list, no caption, the field is "Reason".

Contract used (shared with the server stream, unchanged): `categories: string[]` in the order tapped; `generated: boolean`; `category` stays the first reason.

## 3. Tests (all written first, red then green)

- `packages/web/test/reviewNoteReasons.test.ts` (logic, 17): `REV-01` which reasons a note has; `REV-02` changing the main reason never loses the others; `REV-03` a generated note needs no AI; `REV-04` no clash with a reason the supervisor also tapped.
- `packages/web/test/reviewNoteReasons.test.tsx` (through the real Review page with a fake API, 10): `REV-10` chips follow the tap order, "Main reason" in words, field label; `REV-11` changing the main reason keeps the others and confirm sends it, focus returns to the notes heading; `REV-12` generated: caption, no AI line, no suggest call, composed English box; `REV-13` edited note keeps "AI is not sure (40%)" with the reasons; `REV-14` old note unchanged; `REV-15` the molecule is neutral.
- Mutation checks: (1) `aiLine` no longer returns null for a generated note: 2 tests failed (REV-03, REV-12); (2) changing the main reason drops the others: 4 tests failed (REV-02 x3, REV-11); both restored, 27 of 27 pass.

## 4. Measured / run

- `packages/web` and `packages/engine` tests with the temp folder on E:: 111 files, 1,325 tests passed (includes the 27 above); typecheck clean; `check_repo`, `check_docs`, `check_contrast`, `check_bugs` ok.

## 5. Not done, and why

- **`npm run a11y`, `npm run ux`, `E2E_API_PORT=8864 npm run e2e` and the Edge pictures at 1280 and 390 were not run.** The computer's C: drive reached 0 bytes free partway through, which crashes the vitest workers ("Worker exited unexpectedly", ENOSPC) and stopped the tool that runs commands. Nothing was deleted to make room. Re-run them once space is freed (or with `CLAUDE_CODE_TMPDIR` on E:).
- The full server test suite was not re-run in this clone (the server is untouched by this stream), for the same reason.
- Not checked: a real screen reader on the new list; the page against the real server once the server stream's `categories` and `generated` fields exist.
