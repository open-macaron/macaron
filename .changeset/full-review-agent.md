---
"@open-macaron/agent-cli": minor
---

A `full_review` run (#188, part of #186) runs the verify session and the rule review in parallel, each in its own session (the rules' stays read-only, without MCP servers), and merges them into one result.json: a review whose message is the verify answer. When only one of them completes, its part is published, saying the other didn't complete; when neither does, the run fails and can be retried.
