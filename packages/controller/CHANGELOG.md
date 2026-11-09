# @open-macaron/controller

## 0.20.0

### Minor Changes

- b4e2518: Show token usage: the overview's "Runs this month" card becomes "Tokens this month", with progress against the monthly token cap, and each run on the usage and activity pages shows the tokens it used, in millions.

### Patch Changes

- Updated dependencies [b4e2518]
  - @open-macaron/contracts@0.16.0
  - @open-macaron/review@0.3.17

## 0.19.0

### Minor Changes

- 75749f8: Each user has a monthly token cap for their runs on free models, which cost $0 and so never meet the dollar cap. It starts at 500M tokens for everyone (`DEFAULT_MONTHLY_TOKEN_CAP`, existing users included), and the key page shows it beside the dollar cap: tokens used this month, tokens reserved by runs in progress, and a field in millions of tokens that can be changed or cleared for no cap. A run on free models that could pass it is refused with the same words as for dollars: `this run may use up to 50M tokens, and your monthly token cap of 500M has 20M left: raise it on macaron (…), or wait for next month`. Each run records its token ceiling (`runs.token_limit`), reserved until it settles. `MyMonth` gains `monthlyTokenCap`, `tokensUsed` and `tokensReserved`; `PUT /v1/me/monthly-token-cap` sets the cap.

### Patch Changes

- Updated dependencies [75749f8]
  - @open-macaron/contracts@0.15.0
  - @open-macaron/review@0.3.16

## 0.18.0

### Minor Changes

- d9b5191: Every run's tokens are recorded at settlement, paid runs included: Bifrost counts tokens on every rate limit, capped or not, so `runs.tokens_used` no longer waits for a token cap. The footer's spent line shows the thread's total for every thread: `Spent on this thread: $0.26 and 3.4M tokens.` (no longer "on free models"). A failed run still names an exhausted token budget only when its key had a cap.

## 0.17.0

### Minor Changes

- c08acc3: The footer of an answer shows the tokens of the thread's runs on free models, which cost $0: `Spent on this thread: $0.00 and 1.2M tokens on free models.` Each run's token counter is read from its key at settlement, when the key had a token cap, and kept in `runs.tokens_used` (new column).

## 0.16.1

### Patch Changes

- 9dfb39a: `macaron-agent finish` refuses a result that would read badly once published: an attachment no text places (it would never be shown) and a reply to anything but a review comment (it would be quoted after the message, repeating it), each with the exact change to make. The prompt says so too. The last check, after the session, repairs instead of failing the run: unplaced attachments are added after the message, and an unthreadable reply becomes the message when there is none. The pattern of `attachment:<id>` references is shared from contracts (`ATTACHMENT_REFERENCE`).
- Updated dependencies [9dfb39a]
  - @open-macaron/contracts@0.14.1
  - @open-macaron/review@0.3.15

## 0.16.0

### Minor Changes

- b401fb2: Users can pick free models: a model marked `"free": true` in `deploy/bifrost/pricing.json`, with its own `max_run_tokens`, is offered on the key page and labelled `(free, capped by tokens)`. A run whose key allows one is capped by tokens on that key — the smallest ceiling among the key's free models — next to its USD budget, and a request over the cap gets 429; a run on free models alone settles at $0 at once. A run that fails, or is timed out, with its key at the cap says so in the thread (`its token budget was exhausted (…)`). A zero price without the mark is still refused, and paid runs keep their USD budget alone. GLM 5.3 and DeepSeek V4.1 Flash, served free by EnMaaS, are pinned at 50 million tokens per run.

### Patch Changes

- Updated dependencies [b401fb2]
  - @open-macaron/contracts@0.14.0
  - @open-macaron/review@0.3.14

## 0.15.0

### Minor Changes

- 5d473ba: Users pick the models their runs use on the key page: a model and a fast model, among the models the gateway prices. Their picks replace the configuration's defaults for the runs they pay for, but not a model the configuration sets for a mode; a pick that loses its price refuses the run and points at the key page.

### Patch Changes

- Updated dependencies [5d473ba]
  - @open-macaron/contracts@0.13.0
  - @open-macaron/review@0.3.13

## 0.14.0

### Minor Changes

- 5988311: The bot's answers name the model of their run: in the compact footer, the review's footer and the status comment's header.

## 0.13.0

### Minor Changes

- 96f4b99: `GET /v1/me` says when the user closed the web app's onboarding (`onboardedAt`, null until then), and `PUT /v1/me/onboarding` records it, keeping the first time. Existing accounts count as onboarded.

### Patch Changes

- Updated dependencies [96f4b99]
  - @open-macaron/contracts@0.12.0
  - @open-macaron/review@0.3.12

## 0.12.0

### Minor Changes

- b4e12f4: OpenRouter is removed: Bifrost is the only LLM gateway, and its variables (`BIFROST_ADMIN_URL`, `BIFROST_PUBLIC_URL`, `BIFROST_ADMIN_PASSWORD`, `LLM_PRICING_FILE`) are required. `LLM_BACKEND` and the `OPENROUTER_*` variables are gone (a leftover value is ignored), and a migration drops `runs.key_backend`.

## 0.11.0

### Minor Changes

- 9e9b47f: `implement` and `address_review` runs get the project's rules from open-macaron/knowledge: an index in the system prompt, the full text in a file per rule, and the instruction to check their changes against the rules that match before finishing.

### Patch Changes

- Updated dependencies [9e9b47f]
  - @open-macaron/contracts@0.11.0
  - @open-macaron/review@0.3.11

## 0.10.0

### Minor Changes

- 891f775: The bot refuses `@macaron-bot review` on its own open pull request, and from an issue that has one, and suggests `verify` instead.

## 0.9.0

### Minor Changes

- 9ca6995: The projects move from the Overview page to a Projects page in the menu. `GET /v1/projects` now serves pages of rows (`limit`, `after`), loaded 25 at a time.

### Patch Changes

- Updated dependencies [9ca6995]
  - @open-macaron/contracts@0.10.0
  - @open-macaron/review@0.3.10

## 0.8.0

### Minor Changes

- a71ccab: The web app's Overview page lists every configured project and repository, with whether each one finished onboarding (`GET /v1/projects`).

### Patch Changes

- Updated dependencies [a71ccab]
  - @open-macaron/contracts@0.9.0
  - @open-macaron/review@0.3.9

## 0.7.0

### Minor Changes

- 703d412: The controller now owns the bot's forks, so onboarding a repository is just the open-macaron/config pull request. When a configuration goes live, and at every boot, the controller does four things for each repository:
  
  - It forks the upstream under a random name, or adopts the bot's existing fork of that fork network.
  - It switches off the fork's Actions, wiki, issues and projects.
  - It records the fork by repository id in a new `forks` table.
  - It comments on the config pull request with the fork's link, or with why there is none.
  
  Requests on a repository are refused until its fork is ready. A repository file's `fork` key is now ignored, so a configuration can't point a repository at another of the bot's repositories. The comment needs `GH_ORG` to have Pull requests write on open-macaron/config.

### Patch Changes

- Updated dependencies [703d412]
  - @open-macaron/contracts@0.8.0
  - @open-macaron/review@0.3.8

## 0.6.0

### Minor Changes

- acf0af5: Admins see the bot's activity: an Activity page lists every run with who asked for it, its instruction, status, cost, failure and workflow run, and every refused request with the reason it was answered with. Filters (person, repository, status, mode) live in the URL, and each user's row on the Users page links to their activity. The controller now keeps a refused request's reason (`events.refusal`) and serves `GET /v1/admin/runs` and `GET /v1/admin/refusals`.

### Patch Changes

- Updated dependencies [acf0af5]
  - @open-macaron/contracts@0.7.0
  - @open-macaron/review@0.3.7

## 0.5.0

### Minor Changes

- 3a1032a: Compact mode, on by default: a request gets 👀 and then a single answer, with its loop, mode, runner, run and the thread's spending in a `<sub>` footer, instead of a status comment as soon as the run starts. Set `compact: false` in a project or repository of open-macaron/config to keep the status comment. Failures are posted in both modes, now including a run that couldn't be started, which is no longer retried automatically. A review's footer names its loop and runner.

### Patch Changes

- Updated dependencies [3a1032a]
  - @open-macaron/contracts@0.6.0
  - @open-macaron/review@0.3.6

## 0.4.4

### Patch Changes

- b604d5d: `@macaron-bot retry` replays the last refused request (a platform not enabled yet, an account or a capability missing) once its cause is fixed, instead of answering that there is no failed loop to retry.

## 0.4.3

### Patch Changes

- 11f2d38: Bifrost v2.3.2: v2.3.0 leaked a goroutine every 3 seconds until it was OOM-killed, and the restart dropped the providers of in-flight runs. The admin client is regenerated from v2.3.2's OpenAPI document.

## 0.4.2

### Patch Changes

- 4daadd6: Run on Node.js 24.22.1 with libbrotli 1.2.1, which fix CVE-2026-111497 (Node2Shell, remote code execution in the Brotli decoder). The images now build on Red Hat's hardened Hummingbird Node.js images: UBI's have no fix yet.

## 0.4.1

### Patch Changes

- Updated dependencies [fbd5b6e]
  - @open-macaron/contracts@0.5.0
  - @open-macaron/review@0.3.5

## 0.4.0

### Minor Changes

- 1cc069c: Every run is billed to the LLM key of whoever asked for it; there is no shared LLM key any more. Before a run, the controller checks the payer's saved key with its endpoint (a key the endpoint refuses is marked rejected), then adds it to Bifrost for that run only: each approved endpoint is a Bifrost provider (`macaron-ep-<id>`) priced from the pinned `pricing.json` (`LLM_PRICING_FILE`), and the run's virtual key may use that key alone. The key leaves Bifrost when the run stops spending; Housekeeping sweeps leftovers. Runs record their payer (`runs.payer_id`) and the key's history lists each run. Without a usable key, the bot answers with a refusal linking to the key page, and the web app's overview says so. Bifrost's shared provider and `LLM_UPSTREAM_URL`/`LLM_UPSTREAM_KEY` are gone, and `LLM_BACKEND=openrouter` refuses runs.
- 7dfb14e: Each user may set a monthly cap on what their key is billed (`users.monthly_cap_micros`, `PUT /v1/me/monthly-cap`, `GET /v1/me/month`). A run that could pass it is refused, with what's left: this month's settled runs billed to the user, plus their runs still in progress, plus the run's limit. The key page sets the cap and shows how much of it is used; the overview shows a gauge.

### Patch Changes

- Updated dependencies [7dfb14e]
  - @open-macaron/contracts@0.4.0
  - @open-macaron/review@0.3.4

## 0.3.0

### Minor Changes

- 9ab8f08: Who may trigger the bot is an account of the web app, no longer open-macaron/config's `users` lists: a mention counts only from someone with an account (by their GitHub id) or a review bot the configuration lists. A run's mode needs the capability `requiredCapability` names, held by the account it runs for: explicit commands, retries and the bot's own escalations alike; a review bot's comments count for whoever asked for the thread's last run. Asking for something one's account can't is refused with a reply that names the capability. `MACARON_ALLOWED_USER_IDS` is gone (invitations do its job); a project's `users` list is deprecated and ignored.
- b6b02bf: Approved LLM endpoints: the APIs users may send their own key to. Administrators approve them from the web app (Administration → Endpoints: a name, an https base URL whose host resolves to public addresses, an optional pricing note), then disable or enable them; a base URL never changes, and every change is recorded in `admin_audit`. `LLM_ENDPOINT_DEFAULTS` (a JSON list in the settings) approves the deployment's defaults at start, adding those missing and never updating one.
- 47abc60: Users save their own LLM key, for an approved endpoint (Settings → LLM key). The key is checked against the endpoint (`GET /v1/models`, no redirect), then sealed with AES-256-GCM under a key-encryption key from the Secret `macaron-llm-kek` (`LLM_KEK_DIR`, files `v1`, `v2`…), bound to its user and endpoint. It's write-only: only its last 4 characters are ever shown. Saving or deleting needs a sign-in younger than 10 minutes and is limited to 5 attempts an hour; each change is in the key's append-only history. `node dist/rotate-llm-keys.js` re-seals every key under the newest key-encryption key.

### Patch Changes

- Updated dependencies [9ab8f08]
- Updated dependencies [b6b02bf]
- Updated dependencies [47abc60]
  - @open-macaron/contracts@0.3.0
  - @open-macaron/review@0.3.3

## 0.2.0

### Minor Changes

- 415a29e: Sign-in for the web app: better-auth with the org GitHub App, by invitation only (or the operator's `MACARON_ADMIN_USER_IDS`). GitHub's OAuth tokens are never stored and no IP address is kept. New routes for the web app only: `/v1/me` (profile, capabilities, usage history) and `/v1/admin` (invitations, users' capabilities, audited). Runs record the GitHub id of who asked for them. Sign-in stays off until `BETTER_AUTH_SECRET`, `GITHUB_LOGIN_CLIENT_ID`, `GITHUB_LOGIN_CLIENT_SECRET` and `MACARON_ADMIN_USER_IDS` are set.

### Patch Changes

- Updated dependencies [6b1ed0d]
  - @open-macaron/contracts@0.2.0
  - @open-macaron/review@0.3.2

## 0.1.0

### Minor Changes

- f238b34: The controller can load its configuration from open-macaron/config's GitHub Pages snapshot (`CONFIG_URL`, `CONFIG_REPO_ID`) instead of `CONFIG_DIR`. It reloads when that repository's Pages deployment succeeds, applies a snapshot only if it is valid and the active LLM backend prices its models, and starts on the last applied snapshot (`config_snapshots`) when Pages is unavailable. contracts gains `PublishedConfig` and `parseConfigTree`'s shared validation.

### Patch Changes

- 92b7ca5: `parseConfigTree`, `readConfigFiles` and `loadConfigTree` move to contracts, so config-cli validates open-macaron/config with the controller's own checks. knowledge-cli's owner-approved merge now comes from the shared `@open-macaron/owners` package, with the same behavior and the same status comments. New: `@open-macaron/config-cli` (validate, build the Pages snapshot, owner-approved merges that leave changes to trust and spending settings to the platform team).
- Updated dependencies [92b7ca5]
- Updated dependencies [f238b34]
  - @open-macaron/contracts@0.1.0
  - @open-macaron/review@0.3.1
