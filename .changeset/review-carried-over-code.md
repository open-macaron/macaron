---
"@open-macaron/review": minor
"@open-macaron/controller": patch
---

Reviews no longer report code a change only moves: a violation quoting a line the diff removes elsewhere (moved or re-indented code) is ignored, and the judge is told that what an edited line already had isn't the change's doing. Explanations say what the quoted code is before the fix. `macaron-review` prints what needs attention in full and the rules that passed or don't apply on one line (`--verbose` shows them all), without the repeated severity, with short quotes and costs rounded to the cent plus a total.
