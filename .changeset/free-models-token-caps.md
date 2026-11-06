---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/web": minor
---

Users can pick free models: a model marked `"free": true` in `deploy/bifrost/pricing.json`, with its own `max_run_tokens`, is offered on the key page and labelled `(free, capped by tokens)`. A run whose key allows one is capped by tokens on that key — the smallest ceiling among the key's free models — next to its USD budget, and a request over the cap gets 429; a run on free models alone settles at $0 at once. A run that fails, or is timed out, with its key at the cap says so in the thread (`its token budget was exhausted (…)`). A zero price without the mark is still refused, and paid runs keep their USD budget alone. GLM 5.3 and DeepSeek V4.1 Flash, served free by EnMaaS, are pinned at 50 million tokens per run.
