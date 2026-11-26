# @open-macaron/web

## 0.15.5

### Patch Changes

- 07db484: Security fixes: bump `body-parser` (2.3.0 → 2.4.0), `qs` (6.16.0 → 6.17.1), `undici` (6.29.0 → 6.29.1).

## 0.15.4

### Patch Changes

- b1a417e: Bump `@playwright/test` (1.64.1 → 1.65.1), `@swc/core` (1.16.18 → 1.16.22), `@testcontainers/postgresql` (12.2.0 → 12.2.2), `@vitest/coverage-v8` (5.0.4 → 5.1.1), `eslint` (10.12.0 → 10.15.0), `globals` (17.13.0 → 17.14.0), `msw` (3.0.3 → 3.0.7), `typescript-eslint` (8.71.1 → 8.73.0), `vitest` (5.0.4 → 5.1.1).

## 0.15.3

### Patch Changes

- 8114bef: Bump `@secretlint/secretlint-rule-pattern` (13.0.7 → 13.1.0), `@secretlint/secretlint-rule-preset-recommend` (13.0.7 → 13.1.0), `better-auth` (1.7.11 → 1.7.27), `file-type` (22.1.1 → 22.3.0), `jose` (6.2.12 → 6.2.18), `markdown-table` (3.0.4 → 3.1.0), `unist-util-visit` (5.1.0 → 5.2.0), `zod` (4.6.6 → 4.6.7).

## 0.15.2

### Patch Changes

- e1b3579: Bump `tailwind-variants` (3.3.1 → 4.0.2).

## 0.15.1

### Patch Changes

- 0bf7f93: The Models card says which commands run on the default model (`verify` among them), and the review model's blank option reads "Same as your default model".
- 4f09441: Bump `hummingbird/nodejs:24` (new digest).
- 2d33ac7: Bump `@lucide/svelte` (1.60.0 → 1.78.0), `@sveltejs/adapter-node` (6.0.0 → 6.0.5), `@sveltejs/kit` (3.1.0 → 3.4.0), `@tailwindcss/vite` (4.3.3 → 4.3.5), `bits-ui` (2.19.5 → 2.22.0), `cn` (0.5.0 → 0.5.2), `eslint-plugin-svelte` (3.23.1 → 3.24.1), `layerchart` (2.9.2 → 2.11.0), `shadcn-svelte` (1.7.0 → 1.8.1), `svelte` (5.57.2 → 5.59.1), `svelte-check` (4.7.7 → 4.7.8), `svelte-eslint-parser` (1.9.0 → 1.11.0), `svelte-sonner` (1.2.1 → 1.2.3), `tailwindcss` (4.3.3 → 4.3.5), `vite` (8.3.4 → 8.3.8).

## 0.15.0

### Minor Changes

- a62e0ea: Each user picks the model that checks the knowledge rules: a "Review model" on the key page, their default model when left blank. It runs their `review`s and the rule checks of their `full-review`s. The configuration's per-mode `models` (`models.review`) are deprecated and ignored: a benchmark on five Podman Desktop pull requests found the free DeepSeek V4.1 Flash as good as Sonnet at it. A pick a run doesn't use no longer refuses it when it loses its price.

## 0.14.1

### Patch Changes

- bdba764: A `full_review` mode, not reachable yet (#187, part of #186): a verify session and the rule review in one run, published as one GitHub review. It needs both the `verify` and `review` capabilities (`requiredCapabilities` replaces `requiredCapability`), sets the project up, and is budgeted as a verify plus a review, so the configuration has no budget of its own for it. A review result may carry the verify answer in `message`.

## 0.14.0

### Minor Changes

- cfb4f0f: The configuration is per GitHub organisation: `orgs/<org>/org.yaml` replaces `projects/`. An org file names its owner by account id, lists its repositories under `repos`, and may give every repository it doesn't list a `fallback` (any repository setting). The controller follows a renamed org by its id, forks a fallback repository on its first request, and refuses archived ones. There is no org budget (the former project budget is gone): every run is paid by whoever asked for it, under their own monthly cap, with the per-repository and per-thread caps as before; the ledger records each row's org, existing rows included. config-cli reserves `id` and `fallback` for the platform team and checks each org's id. The web app's Projects page becomes Organisations (`GET /v1/orgs`).

## 0.13.0

### Minor Changes

- 5eabb9c: Add an admin Models page: each model's average cost and tokens per settled run over the last 7, 30 or 90 days, as ranked bar charts, with totals in a table (`GET /v1/admin/models`).

## 0.12.0

### Minor Changes

- b4e2518: Show token usage: the overview's "Runs this month" card becomes "Tokens this month", with progress against the monthly token cap, and each run on the usage and activity pages shows the tokens it used, in millions.

## 0.11.0

### Minor Changes

- 75749f8: Each user has a monthly token cap for their runs on free models, which cost $0 and so never meet the dollar cap. It starts at 500M tokens for everyone (`DEFAULT_MONTHLY_TOKEN_CAP`, existing users included), and the key page shows it beside the dollar cap: tokens used this month, tokens reserved by runs in progress, and a field in millions of tokens that can be changed or cleared for no cap. A run on free models that could pass it is refused with the same words as for dollars: `this run may use up to 50M tokens, and your monthly token cap of 500M has 20M left: raise it on macaron (…), or wait for next month`. Each run records its token ceiling (`runs.token_limit`), reserved until it settles. `MyMonth` gains `monthlyTokenCap`, `tokensUsed` and `tokensReserved`; `PUT /v1/me/monthly-token-cap` sets the cap.

## 0.10.0

### Minor Changes

- b401fb2: Users can pick free models: a model marked `"free": true` in `deploy/bifrost/pricing.json`, with its own `max_run_tokens`, is offered on the key page and labelled `(free, capped by tokens)`. A run whose key allows one is capped by tokens on that key — the smallest ceiling among the key's free models — next to its USD budget, and a request over the cap gets 429; a run on free models alone settles at $0 at once. A run that fails, or is timed out, with its key at the cap says so in the thread (`its token budget was exhausted (…)`). A zero price without the mark is still refused, and paid runs keep their USD budget alone. GLM 5.3 and DeepSeek V4.1 Flash, served free by EnMaaS, are pinned at 50 million tokens per run.

## 0.9.0

### Minor Changes

- 5d473ba: Users pick the models their runs use on the key page: a model and a fast model, among the models the gateway prices. Their picks replace the configuration's defaults for the runs they pay for, but not a model the configuration sets for a mode; a pick that loses its price refuses the run and points at the key page.

## 0.8.0

### Minor Changes

- c0a13be: The onboarding opens by itself at a user's first visit, and closing it (Skip, Finish, Escape, or following its "Save your key") records it, so it doesn't open again. `?welcome` no longer opens it.

## 0.7.0

### Minor Changes

- 2d1bd1d: An onboarding dialog over the overview: what macaron-bot is, how it runs on GitHub Actions, the commands you may ask for and where, how to bring a project, where to get help, and your key. `?welcome` opens it until first sign-ins are recorded.

## 0.6.0

### Minor Changes

- 9ca6995: The projects move from the Overview page to a Projects page in the menu. `GET /v1/projects` now serves pages of rows (`limit`, `after`), loaded 25 at a time.

## 0.5.0

### Minor Changes

- a71ccab: The web app's Overview page lists every configured project and repository, with whether each one finished onboarding (`GET /v1/projects`).

## 0.4.0

### Minor Changes

- acf0af5: Admins see the bot's activity: an Activity page lists every run with who asked for it, its instruction, status, cost, failure and workflow run, and every refused request with the reason it was answered with. Filters (person, repository, status, mode) live in the URL, and each user's row on the Users page links to their activity. The controller now keeps a refused request's reason (`events.refusal`) and serves `GET /v1/admin/runs` and `GET /v1/admin/refusals`.

## 0.3.1

### Patch Changes

- 4daadd6: Run on Node.js 24.22.1 with libbrotli 1.2.1, which fix CVE-2026-111497 (Node2Shell, remote code execution in the Brotli decoder). The images now build on Red Hat's hardened Hummingbird Node.js images: UBI's have no fix yet.

## 0.3.0

### Minor Changes

- 1cc069c: Every run is billed to the LLM key of whoever asked for it; there is no shared LLM key any more. Before a run, the controller checks the payer's saved key with its endpoint (a key the endpoint refuses is marked rejected), then adds it to Bifrost for that run only: each approved endpoint is a Bifrost provider (`macaron-ep-<id>`) priced from the pinned `pricing.json` (`LLM_PRICING_FILE`), and the run's virtual key may use that key alone. The key leaves Bifrost when the run stops spending; Housekeeping sweeps leftovers. Runs record their payer (`runs.payer_id`) and the key's history lists each run. Without a usable key, the bot answers with a refusal linking to the key page, and the web app's overview says so. Bifrost's shared provider and `LLM_UPSTREAM_URL`/`LLM_UPSTREAM_KEY` are gone, and `LLM_BACKEND=openrouter` refuses runs.
- 7dfb14e: Each user may set a monthly cap on what their key is billed (`users.monthly_cap_micros`, `PUT /v1/me/monthly-cap`, `GET /v1/me/month`). A run that could pass it is refused, with what's left: this month's settled runs billed to the user, plus their runs still in progress, plus the run's limit. The key page sets the cap and shows how much of it is used; the overview shows a gauge.

## 0.2.0

### Minor Changes

- b6b02bf: Approved LLM endpoints: the APIs users may send their own key to. Administrators approve them from the web app (Administration → Endpoints: a name, an https base URL whose host resolves to public addresses, an optional pricing note), then disable or enable them; a base URL never changes, and every change is recorded in `admin_audit`. `LLM_ENDPOINT_DEFAULTS` (a JSON list in the settings) approves the deployment's defaults at start, adding those missing and never updating one.
- 47abc60: Users save their own LLM key, for an approved endpoint (Settings → LLM key). The key is checked against the endpoint (`GET /v1/models`, no redirect), then sealed with AES-256-GCM under a key-encryption key from the Secret `macaron-llm-kek` (`LLM_KEK_DIR`, files `v1`, `v2`…), bound to its user and endpoint. It's write-only: only its last 4 characters are ever shown. Saving or deleting needs a sign-in younger than 10 minutes and is limited to 5 attempts an hour; each change is in the key's append-only history. `node dist/rotate-llm-keys.js` re-seals every key under the newest key-encryption key.

## 0.1.1

### Patch Changes

- 5897e6a: Sessions stay alive while you use the app: the browser renews its session cookie once per visit (they used to end after 7 days, active or not). The sidebar and sign-in page show the macaron mark.

## 0.1.0

### Minor Changes

- 04a334a: The web app: SvelteKit 3 with adapter-node, shadcn-svelte, a strict CSP, and its image (`ghcr.io/open-macaron/web`), deployed behind the edge. This release is the shell (sidebar, overview, usage and key pages, sign-in screen); sign-in, keys and usage history come next.
- 6928696: Sign in with GitHub, by invitation. The overview and the usage page show your runs and their cost; administrators invite people with capabilities and change them on the Users page.
