---
"@open-macaron/controller": minor
---

The footer of an answer shows the tokens of the thread's runs on free models, which cost $0: `Spent on this thread: $0.00 and 1.2M tokens on free models.` Each run's token counter is read from its key at settlement, when the key had a token cap, and kept in `runs.tokens_used` (new column).
