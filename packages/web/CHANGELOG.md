# @open-macaron/web

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
