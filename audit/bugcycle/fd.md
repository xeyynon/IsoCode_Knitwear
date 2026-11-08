# Final bug cycle: corrected claims for the Technical Design Document

Written 9 November 2026 by the documents stream (FD) of the final bug cycle. It lists each statement in the submitted TDD that the hunters found stale or wrong, and the exact replacement. The finding ids are the hunters' (`FE-D-nn`, from the reviewer-path hunt).

Numbers below were first measured in a clean clone of `main` at `3bbabf0` (149 files, 2,397 tests). **On the merged tree of the final bug cycle (on top of `2364e91`) `npm test` gives 180 files passed, 1 skipped; 2,693 tests passed, 16 skipped, 0 failed: use 2,693.** (Older figure: 2,397 tests passed, 16 skipped, 0 failed.

## 1. FE-D-01 (S1): "An installable PWA" is false today

The app has a service worker and works with no signal, but it has no web app manifest and no icons, so a browser does not offer to install it.

- **Current TDD text (section 3, "The pieces"):** "An installable PWA. A service worker keeps every screen and the Tamil font available with no signal; updates are saved in IndexedDB and sent when the phone is back online."
- **Version A (use this if no manifest is added):** "Works with no signal. A service worker keeps every screen and the Tamil font available offline; updates are saved in IndexedDB and sent when the phone is back online. (It is not packaged as an installable app: there is no web app manifest yet.)"
- **Version B (use this only after the manifest and icons are merged and deployed):** "An installable web app. A web app manifest and icons let a phone add it to the home screen, and a service worker keeps every screen and the Tamil font available with no signal; updates are saved in IndexedDB and sent when the phone is back online."
- Any other place that says "PWA" in the TDD (the section 1 list of pieces and the section 8 testing table) should use the same wording as the version chosen.

## 2. FE-D-02: the test count

- **Current text (section 8, table row "Automated suite"):** "2,382 tests pass (148 files; 16 skipped that need a real Postgres server; none failed). The skipped ones run in CI against a real Postgres."
- **Replace with:** "2,693 tests pass (180 files; 16 skipped that need a real Postgres server; none failed). The skipped ones run in CI against a real Postgres."
- If the number changes again before submission, re-run `npm test` and use the new total. The phrase "about 2,400 tests" does not go stale and is acceptable in running text.
- Everything else the hunter re-measured is correct and needs no change: 17 tables, 19 migrations, 48 accessibility-audited screens, 55 screen-widths, 22 offline browser checks, 11 screens.

## 3. FE-D-03: the decision log is not in the repository

The decision log and the lists of what was tried and failed are in `md/`, which is kept out of the repository. What is in the repository: `audit/` (audit reports, plan, progress notes), `docs/builds/` and `CHANGELOG.md` (what each build changed and how it was checked), `docs/status.md`, and, for the amber/red rule, the comment and tests in `packages/engine` (decision DEC-010).

- **Current text (section 7, last paragraph):** "These changes are recorded in the repository's decision log."
- **Replace with:** "These changes are recorded in the audit notes and build reports in the repository (`audit/PROGRESS.md`, `docs/builds/`)."
- **Current text (section 11):** "The decisions are recorded in the repository (a decision log with the reasons and the alternatives I rejected, and a list of what was tried and failed)."
- **Replace with:** "The reasons for the main decisions are recorded in the repository's audit notes and build reports (`audit/`, `docs/builds/`); a fuller decision log and a list of what was tried and failed are kept as working notes outside the repository."
- **Section 5.3 sentence "decision DEC-010, recorded with the tests"** stays: it is true (the rule and its tests are in `packages/engine`).

## 4. FE-D-11: assumption A8

- **Current text (assumption table, row A8, column "Where it lives"):** "`settings` (`reasons`)"
- **Replace with:** "`settings` (`reason_categories`)"
- The list itself in the row (not enough workers, workers on leave, machine problem, material is late, no power, fixing quality, something else) matches migration 006 word for word.

## 5. FE-D-13: the commit history note

- **Current text (section 10, "Honest limits"):** "Commit history: the repository's early history was squashed into larger commits at the end. The unsquashed history is kept under tags in the same repository."
- **Replace with:** "Commit history: `main` is squashed, one commit per pull request, so a working day shows as a few large commits (27 commits on `main`). The full earlier history is kept under tags in the same repository: `git log build-1008` lists 75 commits, and the tags `InBul11` to `InBul18`, `build-1007` and `build-1008` mark its steps. The README has a History paragraph that says the same."

## 6. The sign-in limiter statement (finding FE-X-01 and FE-S-09, from the security and supervisor hunts)

The sign-in limiter counts failures per network address, not per account. After 10 wrong attempts from one address, every sign-in from that address, including a correct one, is refused for 15 minutes. Separately, five wrong PINs on a supervisor's account lock that account for 15 minutes. Phones that are already signed in keep working (a supervisor's token lasts 30 days).

- **Current text (section 9, "Sign-in"):** "passwords and PINs are hashed with scrypt; repeated failures lock the account and rate-limit the address; tokens are signed and expire (a merchandiser's after 12 hours, a supervisor's after 30 days, so a phone is not signed out mid-shift)."
- **If the limiter is NOT changed before submission, replace with:** "passwords and PINs are hashed with scrypt; five wrong PINs lock a supervisor's account for 15 minutes, and ten wrong attempts from one network address pause every sign-in from that address for 15 minutes (a known limit: a whole factory behind one router would share that address, and a merchandiser's PIN reset clears an account lock); tokens are signed and expire (a merchandiser's after 12 hours, a supervisor's after 30 days, so a phone that is already signed in keeps working)."
- **If the limiter IS changed (per account and address, with a higher per-address ceiling), state the new rule instead and keep the first half of the sentence.**
- Add to "Honest limits" (section 10), whichever way it goes: "The sign-in lock-out can be used to lock a known supervisor out for 15 minutes; a merchandiser's PIN reset clears it."

## 7. Other claims checked and found correct (no change)

The hunters found these true and the TDD may keep them: the board sentences quoted from the live demo, the demo logins and both buyer links, buyer isolation (Company B sees 4 orders, Company C sees 3, with no overlap), the offline claim (20 updates arrive once, tested), the AI-with-no-key behaviour, 17 tables and 19 migrations, and the live app's HTTPS and health.

## 8. Decisions left to the owner (not documents)

- **A licence.** The repository has none, and the README says "No licence has been chosen yet, so all rights are reserved by default." For an assessment submission that is acceptable. If a licence is wanted: MIT (permissive, one short file), Apache-2.0 (permissive with a patent grant), or "all rights reserved" stated explicitly (what the README says now). Adding a file is the owner's call.
- **The GitHub description** is "Assignment for Isocode" and the repository has no topics. This is a setting on github.com, not a file.
- **The `audit/` folder** is 268 files, mostly screenshots. `audit/README.md` now says what it is.
