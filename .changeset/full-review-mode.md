---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/agent-cli": minor
"@open-macaron/web": patch
---

A `full_review` mode, not reachable yet (#187, part of #186): a verify session and the rule review in one run, published as one GitHub review. It needs both the `verify` and `review` capabilities (`requiredCapabilities` replaces `requiredCapability`), sets the project up, and is budgeted as a verify plus a review, so the configuration has no budget of its own for it. A review result may carry the verify answer in `message`.
