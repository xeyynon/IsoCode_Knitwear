# POA: close the gaps for submission (8 Nov 2026)

From the audit against the brief. Work runs top to bottom; each step is its own commit.

| # | Step | Done when |
|---|---|---|
| 0 | Tooling test fails in a folder with a space (`New%20folder`) | `toolingScripts.test.ts` passes from `E:\Projects\isocode\New folder` |
| 1 | **Demo seed from the brief's sample data**: Company B (UK) and Company C (Germany); B-PO-88213 (12,000 navy crew neck, Stitching 6,800, ex-factory 20 Nov), B-PO-88240 (8,000 white polo, Finishing 5,200, 12 Nov), C-PO-0488 (10,000 yellow kids printed tee, Printing 3,100, 28 Nov), full TNA stages from a template, a daily update history that adds up to the "Qty done", plus a few illustrative orders (labelled as an assumption), Tamil notes, and one demo account per role. Separate from the test fixture (`test/helpers.ts` stays as is) | `npm run dev:api` shows the brief's three POs; `npm run seed:demo` loads the same data into a real Postgres |
| 2 | **AI reason from Tamil notes**: Claude (`claude-opus-5-5`, structured JSON output) turns a note into an English meaning, a reason from the fixed list and a confidence. Saved beside the original (never replaces it). Below the threshold, or when the model is unreachable or answers outside the list: marked "unsure" for the merchandiser, never guessed. The merchandiser can change the reason; a change is recorded. With no API key, the server says AI is off and a person does it (no fake answers). Tests with a stubbed model: right, wrong-list, unsure, timeout, refusal | Review queue shows original, AI translation, AI reason with confidence, and the merchandiser's override |
| 3 | **Host on Vercel, deploy on every push**: web app as static files, the Fastify API as one serverless function, Postgres on Neon, photos in Postgres (no disk on Vercel), migrations run on deploy, demo clock fixed by `DEMO_TODAY` (assumption, so the seeded figures stay meaningful during review). GitHub repo connected so a push to `main` deploys production and other branches get previews | Live URL signs in with the demo accounts; a push redeploys |
| 4 | **Submission files**: `deployment.md` (run locally, how it is deployed, env var names only, demo logins) and the TDD (Word, GitHub URL and live URL at the top, architecture, data model, flows, AI, UI decisions, assumptions labelled, cuts and next steps) | Both files in one zip |

Also: weekly buyer export as Excel (`.xlsx`) next to the CSV if time allows (brief says PDF or Excel).

Needs from the owner: a Neon (or other) Postgres added to the Vercel project, and an `ANTHROPIC_API_KEY` set in Vercel. Neither is ever written into the repository.

## Status (8 Nov 2026, evening)

All four steps done. Live at https://isocode-knitwear.vercel.app (Vercel Hobby, Neon Free, Groq free plan: ₹0).
Found and fixed on the way: a later stage waiting its turn greyed the whole order (engine); the demo clock shifted token
expiry so the browser refused the sign-in (only the factory's day moves now); the page grid stopped at a short page's end.
The AI runs on Groq (free); Claude and Gemini are built in behind AI_PROVIDER. TDD (PDF) and deployment.md are zipped
outside the repository. Left: push this branch and merge it into main, so GitHub shows the work and main redeploys itself.
