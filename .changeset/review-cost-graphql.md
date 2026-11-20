---
"@open-macaron/controller": patch
---

A review shows its cost once it settles (#204). GitHub's REST API answers 404 to a review's author who has no write access to the repository, which the bot never has upstream, so the ⏳ stayed: the review is now updated through GraphQL (`updatePullRequestReview`), which accepts it.
