---
"@open-macaron/controller": minor
---

`@macaron-bot full-review` (or `full_review`) runs a `verify` and a `review` in one run, posted as one GitHub review (#190, the last part of #186; opt-in, an experiment). It runs on a pull request the bot didn't open, on any platform the repository enables (`full-review on windows <hint>`), for someone with both the `verify` and `review` capabilities. Unlike a `review`, it isn't refused when no rule applies: its verification still runs.
