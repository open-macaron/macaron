# AGENTS.md

Guidance for AI agents (and humans) working in `open-macaron/macaron`: the controller, the contracts and the CLIs of **macaron-bot**, an AI contributor that works on other people's repositories from forks. `CLAUDE.md` is a symlink to this file.

Read first: [README.md](README.md) (what the bot does), [docs/DESIGN.md](docs/DESIGN.md) (architecture, trust boundaries), [docs/ENGINEERING.md](docs/ENGINEERING.md) (stack, modules, lint rules, tests). This file doesn't repeat them; it lists what you need to work here without breaking anything.

## Map

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas shared across the trust boundary (config, run context/result, knowledge). Emits `schemas/*.json` and `openapi/controller.json` |
| `packages/controller` | NestJS 12 controller (runs on OpenShift, holds every credential) |
| `packages/agent-cli` | `macaron-agent`, run on GitHub Actions runners (no GitHub token, one capped LLM key) |
| `packages/review` | The review engine (rule selection, read-only judge session, evidence verification, rendering), shared by the controller and agent-cli, and the `macaron-review` CLI published to npm as `@open-macaron/review` |
| `packages/knowledge-cli` | Validation, owner-approved merges and the Pages read API of open-macaron/knowledge |
| `packages/config-cli` | Validation (the controller's own `parseConfigTree`), owner-approved merges and the Pages snapshot of open-macaron/config. Changes to who can trigger the bot or what it may spend are left to the platform team |
| `packages/owners` | The owner-approved merge both CLIs share: `OWNERS.yaml` per folder, matched by user id, status comment, merge at the evaluated commit |
| [open-macaron/config](https://github.com/open-macaron/config) | Trusted projects, repositories, users, budgets (`global.yaml` → `projects/<p>/project.yaml` → `repos/<r>.yaml`), in its own repository: owner-approved, published on GitHub Pages, reloaded by the controller without a deploy. A copy for tests: `packages/contracts/test/fixtures/config` |
| `deploy/` | `deploy/openshift/`: the production manifests and their scripts (`deploy.sh`, `provision-secrets.sh`), see docs/DEPLOYMENT.md; `deploy/bifrost/`: Bifrost's config template, pinned prices, `dev.sh` |
| `docs/` | Design documents; keep them in sync with what you change |

Related repositories: [open-macaron/runner](https://github.com/open-macaron/runner) (`run.yml`, `environments/`), [open-macaron/knowledge](https://github.com/open-macaron/knowledge) (rules and lessons, its own README explains approvals).

## Commands

```sh
pnpm install
pnpm check                      # typecheck + lint + all tests
pnpm exec vitest run --project controller        # unit tests of one package (contracts, review, agent-cli, controller, knowledge-cli, owners, config-cli)
pnpm test:live                  # live tests against Bifrost/GitHub/OpenRouter (~/.config/macaron/dev.env; each skipped without its variables)
deploy/bifrost/dev.sh up        # local Bifrost + Postgres behind the production edge, for the Bifrost live test (LLM_UPSTREAM_URL, LLM_UPSTREAM_KEY, BIFROST_ADMIN_PASSWORD in dev.env)
pnpm --filter @open-macaron/controller gen:bifrost   # Bifrost admin client, when bumping the Bifrost image
pnpm --filter @open-macaron/controller db:generate   # after changing src/db/schema.ts
pnpm --filter @open-macaron/controller db:check
pnpm changeset                  # what this PR releases (pnpm changeset --empty: nothing)
```

Integration tests (`controller-integration`) need a container runtime (Testcontainers). Without one locally they fail to start; CI runs them. With rootless Podman: `DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock TESTCONTAINERS_RYUK_DISABLED=true` (if the socket file is missing, `systemctl --user restart podman.socket`).

## Code rules (enforced by lint and review)

- **Strict TypeScript, no casts.** `consistent-type-assertions: never` applies to tests too (no `as`, no `as const`). Validate unknown data with Zod (`schema.parse(data)`), type it `unknown` first if a library returns `any`.
- **Maintained libraries over hand-rolled code.** Look for one before writing a parser, a client or a protocol. Prefer clients generated from OpenAPI over guessed contracts.
- **Dependencies** go in the `catalog:` of `pnpm-workspace.yaml`, pinned. `minimumReleaseAge` is 3 days: a version younger than that fails the install, so pick the newest that has matured.
- **Comments** explain why, at the density of the surrounding code. No narration of what the code does.
- **`process.env`** is read only in the validated env modules (`config/env.ts`, `agent-cli/src/inputs.ts`).
- **Leave the code better, within scope.** Never include a fix outside your task. When you find a problem, something to improve or an idea, open an issue on open-macaron/macaron (`gh issue create`) with the matching label (`bug`, `enhancement`, `documentation`).

## Generated code (CI fails on drift)

Changing `packages/contracts` usually means regenerating, in this order:

```sh
pnpm --filter @open-macaron/contracts gen       # JSON Schemas
pnpm --filter @open-macaron/contracts build     # the controller's gen compiles against contracts' dist: stale dist = wrong errors
pnpm --filter @open-macaron/controller gen      # OpenAPI document
pnpm --filter @open-macaron/agent-cli gen       # agent-cli's client from that document
```

A new `Mode` also needs a migration (`run_mode` enum) and entries in every `Record<Mode, …>` (`allowedActions`, `MODE_INSTRUCTIONS`, `Budgets`).

## Security invariants (never weaken; see DESIGN.md §3, §7)

- **Runners never hold a GitHub token.** Everything public (comments, PRs, reviews, media uploads) is written by the controller, after the **Gate**.
- **The bot never has write access upstream:** it works from its forks. Uploads that need write access target the fork.
- **Agent output is untrusted:** results are schema-validated and gated; review violations stand only with a quote of an added line; mentions are defused (`sanitize()`).
- **Read-only sessions** (reviews) get `--permission-mode dontAsk`, a short tool list, and never MCP servers. They're defined once, in `packages/review` (`claudeReviewArgs`), for the bot and the local CLI alike.
- **Secrets are never printed, logged or committed.** Scripts read them from `~/.config/macaron/dev.env` without echoing; the cluster gets them through `deploy/openshift/scripts/provision-secrets.sh` (pipes and a server-side apply, never a command line).
- **Nothing from a pull request's checkout is executed in a privileged context** (open-macaron/knowledge `merge.yml`; environments that run code only on trusted branches).

## Release and deploy

1. Every PR that changes a package carries a changeset: `pnpm changeset` (packages, bump, a summary for the changelog), or `pnpm changeset --empty` when there is nothing to release. CI (`changeset status`) fails otherwise. Small semantic commits; CI (`ci.yml`) must be green, and a network flake pulling base images is retried, not ignored.
2. `release.yml` keeps a "Version Packages" PR up to date with the pending changesets: versions, `CHANGELOG.md`, and dependents bumped. **It merges itself once CI is green (auto-merge), and that merge is the release** (.changeset/README.md):
   - changesets tags each released package (`@open-macaron/<package>@<version>`) and writes its GitHub release;
   - `release.yml` builds what was released, each with a build provenance attestation: the controller image (`:<version>`, `:sha-<commit>`, `:latest`), the agent-cli, knowledge-cli and config-cli bundles attached to their release, and `@open-macaron/review` on npm (trusted publishing, once the repository variable `NPM_PUBLISH` is `true`).
   
   The Version Packages PR is opened by the org's `open-macaron-release` GitHub App: a one-hour token from `RELEASE_APP_CLIENT_ID` (variable) and `RELEASE_APP_PRIVATE_KEY` (secret), limited to this repository, Contents and Pull requests write. It needs the app because GitHub runs no workflow on a PR opened with `GITHUB_TOKEN`. Without it, run CI on that PR by hand: `gh workflow run ci.yml --ref changeset-release/main`. `main`'s ruleset requires the `check` and `image` jobs and a PR for every change.
3. **Verify before pinning:** `gh attestation verify` on the image digest / bundle (signer workflow on `refs/heads/main`, source digest = the commit).
4. The controller rolls out by itself: the `macaron-controller` ImageStream follows `:latest`, and its image trigger rolls the Deployment (docs/DEPLOYMENT.md §2). Pin by hand only what other repositories use:
   - the agent-cli URL (`…/releases/download/%40open-macaron%2Fagent-cli%40<version>/macaron-agent.mjs`) and its sha256 in open-macaron/runner `run.yml`;
   - the knowledge-cli and config-cli URLs and sha256 in open-macaron/knowledge's and open-macaron/config's workflows. That's a platform PR there: `.github/` is never auto-merged.
5. Manifests, Bifrost, nginx and Postgres are deployed from a clean checkout of `main`, logged in with `oc`: `MACARON_NAMESPACE=<namespace> deploy/openshift/scripts/deploy.sh` (docs/DEPLOYMENT.md §5). It takes a dump first and rolls back a Deployment that doesn't become ready. Secrets and settings change through `provision-secrets.sh`, never `oc edit`.
6. Check the result live (status comment, run, review/PR, cost settlement) on the sandbox repositories in open-macaron/config (`projects/sandbox`), never on repositories outside it.

## Pitfalls already met

- `msw` in integration tests must start **after** Testcontainers (or bypass unknown hosts): it intercepts the container runtime's HTTP calls.
- A merge by the knowledge repository's `GITHUB_TOKEN` fails (403) when the branch is behind `main` on `.github/workflows/`.
- GitHub user-attachments: the upload endpoint needs write access to `repository_id` (404 otherwise) and an asset is private until a saved comment references it.
- Claude Code's `--json-schema` only knows draft 7: no `$schema` key.
- Claude Code doesn't bound MCP tool calls by default: a hung server (electron-test-mcp's `evaluate`) left a run silent until GitHub killed the job. The agent's sessions set `MCP_TOOL_TIMEOUT` (`agent-cli/src/harness.ts`).
- Bifrost: a model without a price is charged $0 (prices are pinned in `deploy/bifrost/pricing.json`); budgets and per-key rate limits are counted after requests, so only the provider-wide concurrency cap bounds a burst; empty lists come back as `null`; virtual keys need `key_ids: ["*"]` to use the provider's keys.
- The edge forwards each matched request to its canonical upstream path (`proxy_pass` with a URI), never the client's: a proxy's matcher normalises paths, the upstream may not.
- OpenShift's `restricted-v2` drops every capability with no-new-privileges: an image whose binary carries a file capability (the official Caddy image) fails with `Operation not permitted`. Prefer Red Hat images built for random UIDs (`ubi10/nginx-126`, `rhel10/postgresql-18`).
- Postgres refuses a TLS key readable beyond its group: the serving-certificate Secret is mounted with `defaultMode: 0640` (root-owned, group = the pod's fsGroup).
- Kustomize reads no file outside its directory by default (`deploy/bifrost/` is): `deploy.sh` builds with `--load-restrictor LoadRestrictionsNone`, and a kustomization's `resources` can't be absolute paths.
- GitHub doesn't list pings among a hook's deliveries, and deliveries can lag by 10–25 min during an incident: the reconcile job, not the webhook, guarantees that a completion is processed.
