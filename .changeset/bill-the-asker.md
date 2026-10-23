---
"@open-macaron/controller": minor
"@open-macaron/web": minor
---

Every run is billed to the LLM key of whoever asked for it; there is no shared LLM key any more. Before a run, the controller checks the payer's saved key with its endpoint (a key the endpoint refuses is marked rejected), then adds it to Bifrost for that run only: each approved endpoint is a Bifrost provider (`macaron-ep-<id>`) priced from the pinned `pricing.json` (`LLM_PRICING_FILE`), and the run's virtual key may use that key alone. The key leaves Bifrost when the run stops spending; Housekeeping sweeps leftovers. Runs record their payer (`runs.payer_id`) and the key's history lists each run. Without a usable key, the bot answers with a refusal linking to the key page, and the web app's overview says so. Bifrost's shared provider and `LLM_UPSTREAM_URL`/`LLM_UPSTREAM_KEY` are gone, and `LLM_BACKEND=openrouter` refuses runs.
