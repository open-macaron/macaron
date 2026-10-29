# @open-macaron/web

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
