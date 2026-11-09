# @open-macaron/contracts

## 0.16.0

### Minor Changes

- b4e2518: Show token usage: the overview's "Runs this month" card becomes "Tokens this month", with progress against the monthly token cap, and each run on the usage and activity pages shows the tokens it used, in millions.

## 0.15.0

### Minor Changes

- 75749f8: Each user has a monthly token cap for their runs on free models, which cost $0 and so never meet the dollar cap. It starts at 500M tokens for everyone (`DEFAULT_MONTHLY_TOKEN_CAP`, existing users included), and the key page shows it beside the dollar cap: tokens used this month, tokens reserved by runs in progress, and a field in millions of tokens that can be changed or cleared for no cap. A run on free models that could pass it is refused with the same words as for dollars: `this run may use up to 50M tokens, and your monthly token cap of 500M has 20M left: raise it on macaron (…), or wait for next month`. Each run records its token ceiling (`runs.token_limit`), reserved until it settles. `MyMonth` gains `monthlyTokenCap`, `tokensUsed` and `tokensReserved`; `PUT /v1/me/monthly-token-cap` sets the cap.

## 0.14.1

### Patch Changes

- 9dfb39a: `macaron-agent finish` refuses a result that would read badly once published: an attachment no text places (it would never be shown) and a reply to anything but a review comment (it would be quoted after the message, repeating it), each with the exact change to make. The prompt says so too. The last check, after the session, repairs instead of failing the run: unplaced attachments are added after the message, and an unthreadable reply becomes the message when there is none. The pattern of `attachment:<id>` references is shared from contracts (`ATTACHMENT_REFERENCE`).

## 0.14.0

### Minor Changes

- b401fb2: Users can pick free models: a model marked `"free": true` in `deploy/bifrost/pricing.json`, with its own `max_run_tokens`, is offered on the key page and labelled `(free, capped by tokens)`. A run whose key allows one is capped by tokens on that key — the smallest ceiling among the key's free models — next to its USD budget, and a request over the cap gets 429; a run on free models alone settles at $0 at once. A run that fails, or is timed out, with its key at the cap says so in the thread (`its token budget was exhausted (…)`). A zero price without the mark is still refused, and paid runs keep their USD budget alone. GLM 5.3 and DeepSeek V4.1 Flash, served free by EnMaaS, are pinned at 50 million tokens per run.

## 0.13.0

### Minor Changes

- 5d473ba: Users pick the models their runs use on the key page: a model and a fast model, among the models the gateway prices. Their picks replace the configuration's defaults for the runs they pay for, but not a model the configuration sets for a mode; a pick that loses its price refuses the run and points at the key page.

## 0.12.0

### Minor Changes

- 96f4b99: `GET /v1/me` says when the user closed the web app's onboarding (`onboardedAt`, null until then), and `PUT /v1/me/onboarding` records it, keeping the first time. Existing accounts count as onboarded.

## 0.11.0

### Minor Changes

- 9e9b47f: `implement` and `address_review` runs get the project's rules from open-macaron/knowledge: an index in the system prompt, the full text in a file per rule, and the instruction to check their changes against the rules that match before finishing.

## 0.10.0

### Minor Changes

- 9ca6995: The projects move from the Overview page to a Projects page in the menu. `GET /v1/projects` now serves pages of rows (`limit`, `after`), loaded 25 at a time.

## 0.9.0

### Minor Changes

- a71ccab: The web app's Overview page lists every configured project and repository, with whether each one finished onboarding (`GET /v1/projects`).

## 0.8.0

### Minor Changes

- 703d412: The controller now owns the bot's forks, so onboarding a repository is just the open-macaron/config pull request. When a configuration goes live, and at every boot, the controller does four things for each repository:
  
  - It forks the upstream under a random name, or adopts the bot's existing fork of that fork network.
  - It switches off the fork's Actions, wiki, issues and projects.
  - It records the fork by repository id in a new `forks` table.
  - It comments on the config pull request with the fork's link, or with why there is none.
  
  Requests on a repository are refused until its fork is ready. A repository file's `fork` key is now ignored, so a configuration can't point a repository at another of the bot's repositories. The comment needs `GH_ORG` to have Pull requests write on open-macaron/config.

## 0.7.0

### Minor Changes

- acf0af5: Admins see the bot's activity: an Activity page lists every run with who asked for it, its instruction, status, cost, failure and workflow run, and every refused request with the reason it was answered with. Filters (person, repository, status, mode) live in the URL, and each user's row on the Users page links to their activity. The controller now keeps a refused request's reason (`events.refusal`) and serves `GET /v1/admin/runs` and `GET /v1/admin/refusals`.

## 0.6.0

### Minor Changes

- 3a1032a: Compact mode, on by default: a request gets 👀 and then a single answer, with its loop, mode, runner, run and the thread's spending in a `<sub>` footer, instead of a status comment as soon as the run starts. Set `compact: false` in a project or repository of open-macaron/config to keep the status comment. Failures are posted in both modes, now including a run that couldn't be started, which is no longer retried automatically. A review's footer names its loop and runner.

## 0.5.0

### Minor Changes

- fbd5b6e: A project file no longer accepts a `users` list (deprecated and ignored since who may trigger the bot became an account of the web app): one with it is refused. open-macaron/config dropped its lists. config-cli no longer reserves `users` for the platform team: the schema refuses it outright.

## 0.4.0

### Minor Changes

- 7dfb14e: Each user may set a monthly cap on what their key is billed (`users.monthly_cap_micros`, `PUT /v1/me/monthly-cap`, `GET /v1/me/month`). A run that could pass it is refused, with what's left: this month's settled runs billed to the user, plus their runs still in progress, plus the run's limit. The key page sets the cap and shows how much of it is used; the overview shows a gauge.

## 0.3.0

### Minor Changes

- 9ab8f08: Who may trigger the bot is an account of the web app, no longer open-macaron/config's `users` lists: a mention counts only from someone with an account (by their GitHub id) or a review bot the configuration lists. A run's mode needs the capability `requiredCapability` names, held by the account it runs for: explicit commands, retries and the bot's own escalations alike; a review bot's comments count for whoever asked for the thread's last run. Asking for something one's account can't is refused with a reply that names the capability. `MACARON_ALLOWED_USER_IDS` is gone (invitations do its job); a project's `users` list is deprecated and ignored.
- b6b02bf: Approved LLM endpoints: the APIs users may send their own key to. Administrators approve them from the web app (Administration → Endpoints: a name, an https base URL whose host resolves to public addresses, an optional pricing note), then disable or enable them; a base URL never changes, and every change is recorded in `admin_audit`. `LLM_ENDPOINT_DEFAULTS` (a JSON list in the settings) approves the deployment's defaults at start, adding those missing and never updating one.
- 47abc60: Users save their own LLM key, for an approved endpoint (Settings → LLM key). The key is checked against the endpoint (`GET /v1/models`, no redirect), then sealed with AES-256-GCM under a key-encryption key from the Secret `macaron-llm-kek` (`LLM_KEK_DIR`, files `v1`, `v2`…), bound to its user and endpoint. It's write-only: only its last 4 characters are ever shown. Saving or deleting needs a sign-in younger than 10 minutes and is limited to 5 attempts an hour; each change is in the key's append-only history. `node dist/rotate-llm-keys.js` re-seals every key under the newest key-encryption key.

## 0.2.0

### Minor Changes

- 6b1ed0d: Users of the web app: `Capability` (what an admin grants each user: triage, plan, implement, reproduce, verify, review, remember) and `requiredCapability` (what each run mode needs); the `/v1/me` and `/v1/admin` schemas (`Me`, `Invitation`, `UserAccount`, `UsagePage`…); `authUserFields`, the user fields better-auth adds, shared by the controller and the web app. `@open-macaron/contracts/capability` and `/auth` are safe to import in a browser.

## 0.1.0

### Minor Changes

- 92b7ca5: `parseConfigTree`, `readConfigFiles` and `loadConfigTree` move to contracts, so config-cli validates open-macaron/config with the controller's own checks. knowledge-cli's owner-approved merge now comes from the shared `@open-macaron/owners` package, with the same behavior and the same status comments. New: `@open-macaron/config-cli` (validate, build the Pages snapshot, owner-approved merges that leave changes to trust and spending settings to the platform team).
- f238b34: The controller can load its configuration from open-macaron/config's GitHub Pages snapshot (`CONFIG_URL`, `CONFIG_REPO_ID`) instead of `CONFIG_DIR`. It reloads when that repository's Pages deployment succeeds, applies a snapshot only if it is valid and the active LLM backend prices its models, and starts on the last applied snapshot (`config_snapshots`) when Pages is unavailable. contracts gains `PublishedConfig` and `parseConfigTree`'s shared validation.
