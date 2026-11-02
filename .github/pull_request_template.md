## What and why
<!-- One or two plain sentences. What does a user now see or get, or what internal work is this? -->

## Build or InBul?
- [ ] **Build**: a user would notice it (report in `docs/builds`, tag `build-N`)
- [ ] **InBul**: internal (title starts `InBulNN:`, no report)

## Checked
- [ ] `npm run verify` passes
- [ ] New behaviour has a test, and I saw it fail without the change
- [ ] For anything on screen: looked at it in a browser at desktop and phone width
- [ ] Status is never shown by colour alone; grey is never shown as green

## Safety
- [ ] No keys, `.env` files, real worker or buyer data, or recordings
- [ ] No budget, rates or client detail in a build report or the changelog
- [ ] No "(Build N)" in the commit title, and `CHANGELOG.md` was not edited by hand

## Not verified
<!-- Be honest: what did you not check? -->
