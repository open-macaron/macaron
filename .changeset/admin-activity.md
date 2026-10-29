---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/web": minor
---

Admins see the bot's activity: an Activity page lists every run with who asked for it, its instruction, status, cost, failure and workflow run, and every refused request with the reason it was answered with. Filters (person, repository, status, mode) live in the URL, and each user's row on the Users page links to their activity. The controller now keeps a refused request's reason (`events.refusal`) and serves `GET /v1/admin/runs` and `GET /v1/admin/refusals`.
