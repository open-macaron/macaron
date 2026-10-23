# @open-macaron/controller

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
