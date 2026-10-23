# @open-macaron/controller

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
