# Final bug cycle: what was left open, and why

Written 9 November 2026. Every finding of the four hunters (merchandiser flows, supervisor flows and the AI path, security and isolation, the reviewer's path) is either fixed, with a test that names its id, or listed here with the reason it was not.

## Closed after the first fix round
- **FE-X-07, no Content-Security-Policy:** fixed. The policy is in `scripts/csp.mjs`, sent by the hosted build, and enforced by the preview server used in the browser checks (`packages/web/test/csp.test.ts`, the check in `scripts/e2e_offline.ts`, and the 48-screen walk in `scripts/a11y.ts` against a preview server). Breaking the policy on purpose (removing `blob:` from `img-src`) made the offline browser test fail with the exact blocked load, then it was restored.
- **FE-X-09, `optimised.md` tracked:** kept on purpose: it is the public record of what was made cheaper to run. The README now says so, and that earlier history contains some working logs with no secrets in them.

## Left open on purpose (product decisions or accepted trade-offs)
| Id | What | Why it was not changed |
| --- | --- | --- |
| FE-M-12 | The same PO number can be entered twice | An order is unique by buyer, PO, style and colour (migration 001): one PO usually carries several styles, so a second line under the same PO is normal. A stricter rule needs the client's say. |
| FE-S-04 | Today lists stages that cannot have output yet | Which stage a supervisor may report on is a floor rule (overlap between cutting and stitching is common); hiding a stage could hide real work. |
| FE-S-11 | A supervisor cannot correct a count that was too small | Corrections go through the merchandiser, who can add a visit update; a supervisor-side undo is a feature, listed as a next step. |
| FE-M-07 (part) | "Total" shows a dash while a size row is invalid | A per-row message is a design choice; the form already refuses the order with a clear summary. |
| FE-X-02 | Anyone who knows a supervisor's phone number can lock that account for 15 minutes with five wrong PINs | The lock is what stops PIN guessing; a merchandiser's PIN reset clears it. Tested (BE-082). |
| FE-X-10 | A repeated client id from a second account is acknowledged as a duplicate | Informational: guessing one needs about 2^122 tries. |
| FE-M-16, FE-M-20 | Not reproduced / owned by another screen | Checked on the merged tree; no defect found. |
| FE-D-13 | `main` has few, large commits | A deliberate rule (one squashed commit per pull request); the full earlier history is under the tags (`git log build-1008`). |

## Decisions that belong to the owner, not to code
- A licence for the repository (none chosen: all rights reserved by default).
- The repository description on github.com.
