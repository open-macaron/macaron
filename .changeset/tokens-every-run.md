---
"@open-macaron/controller": minor
---

Every run's tokens are recorded at settlement, paid runs included: Bifrost counts tokens on every rate limit, capped or not, so `runs.tokens_used` no longer waits for a token cap. The footer's spent line shows the thread's total for every thread: `Spent on this thread: $0.26 and 3.4M tokens.` (no longer "on free models"). A failed run still names an exhausted token budget only when its key had a cap.
