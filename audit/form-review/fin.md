# The "finished" area: how completed production is shown (form review, stream FIN)

Written 10 November 2026. Scope: the top of the Update screen (`UpdateHero`) and the stage card on Today (`StageCard`). Nothing measured or sent changes.

## What it says today (measured on the base, b1f0476, English / Tamil, 390 px)

Update screen hero: a ring with the share in the middle, the order number, then **two big figures: "Today so far" and "Left"**.
- **The pieces already made (1,750) are not on the screen at all**, only as "38%" inside the ring. The two large numbers are what was sent *today* and what is *missing*. A supervisor who has made 1,750 pieces sees "Left 2,800" in the largest type: the work done is the smallest thing, and the gap is the biggest.
- "Today so far 0" is shown as a plain 0, the same size as a good day. A day with nothing sent and a day with 350 look the same weight.
- Hero height 171 px; the number field starts at 362 px (English) and 364 px (Tamil) of 844.

Today card: "Done 1,750 / 4,550 38%" with a bar (good), then "Today 0" in muted text, with a tick only once something was entered. Here the done figure is already the largest; what is missing is the contribution wording ("Today 0" reads like a score) and any sense of what is still to go.

## The pattern

Lead with what has been **made**, say what **today added** in one quiet line, and keep what **remains** as a secondary line.

```
Update hero (390 px, about the same height as now)

  (ring 38%)   B-PO-88240
  (64 px)      tee · navy · due 11 Nov
  ------------------------------------------------
  Done                      (check) 350 added today
  1,750 / 4,550                     2,800 to go

Today card

  [Sewing]                              Due 11 Nov
  B-PO-88240
  Done  1,750 / 4,550                          38%
  [#########-----------------------------------]
  (check) 350 added today            2,800 to go
  [            Update            ]
```

- **Hierarchy:** the made figure is the largest type in the hero (2rem, above the order number's 1.75rem). Contribution and "to go" are one size smaller and quieter.
- **Completed vs pending, not by colour alone:** the ring and the bar fill in the action colour for what is done and sit on a neutral track for what is not; each is also labelled in words ("Done", "to go").
- **Contribution:** "350 added today" with a small check in the action colour, only when today is above 0. When nothing was sent the line is neutral and factual ("Nothing sent yet today"): no check, no red, no "0".
- **Stage complete** (done at or above the plan): "Stage complete" replaces "to go"; the true number is shown (5,100 / 4,550) and only the ring and bar stop at full.
- **No plan** (quantity 0): no share, no "to go", nothing invented.
- **Words:** factual and warm, no exclamation marks, no emoji. Tamil words are drafts (`audit/TAMIL-REVIEW.md`).
- **Not done, on purpose:** no green card, no confetti, no gradient, no edge bar, no animation beyond the ring's existing one-time fill (reduced-motion safe). Colour stays the action colour; status colour is not used here at all.

## Why not something bigger

A "success card" or a celebration would be wrong on this screen: most days are slow, the person is on a cheap phone in daylight, and the number field and Send must stay above the keyboard. The hero therefore stays the same height as before (re-measured below), and the change is in what is large and what is said.
