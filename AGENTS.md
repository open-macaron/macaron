# AGENTS.md

Guidance for AI agents (and humans) working in `open-macaron/macaron`: the controller, the contracts and the CLIs of **macaron-bot**, an AI contributor that works on other people's repositories from forks. `CLAUDE.md` is a symlink to this file.

Read first: [README.md](README.md) (what the bot does), [docs/DESIGN.md](docs/DESIGN.md) (architecture, trust boundaries), [docs/ENGINEERING.md](docs/ENGINEERING.md) (stack, modules, lint rules, tests). This file doesn't repeat them; it lists what you need to work here without breaking anything.

## Map

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas shared across the trust boundary (config, run context/result, knowledge). Emits `schemas/*.json` and `openapi/controller.json` |
| `packages/controller` | NestJS 12 controller (runs on the VPS, holds every credential) |
| `packages/agent-cli` | `macaron-agent`, run on GitHub Actions runners (no GitHub token, one capped LLM key) |
| `packages/review` | The review engine (rule selection, read-only judge session, evidence verification, rendering), shared by the controller and agent-cli, and the `macaron-review` CLI published to npm as `@open-macaron/review` |
| `packages/knowledge-cli` | Validation, owner-approved merges and the Pages read API of open-macaron/knowledge |
| `config/` | Trusted projects, repositories, users, budgets (`global.yaml` → `projects/<p>/project.yaml` → `repos/<r>.yaml`) |
| `deploy/` | Quadlets, Caddy, Bifrost (`deploy/bifrost/`: config, pinned prices, `dev.sh`), `deploy.sh` (runs **on** the VPS) |
| `docs/` | Design documents; keep them in sync with what you change |

Related repositories: [open-macaron/runner](https://github.com/open-macaron/runner) (`run.yml`, `environments/`), [open-macaron/knowledge](https://github.com/open-macaron/knowledge) (rules and lessons, its own README explains approvals).

## Commands

```sh
pnpm install
pnpm check                      # typecheck + lint + all tests
pnpm exec vitest run --project controller        # unit tests of one package (contracts, review, agent-cli, controller, knowledge-cli)
pnpm test:live                  # live tests against Bifrost/GitHub/OpenRouter (~/.config/macaron/dev.env; each skipped without its variables)
deploy/bifrost/dev.sh up        # local Bifrost + Postgres + Caddy for the Bifrost live test (LLM_UPSTREAM_URL, LLM_UPSTREAM_KEY, BIFROST_ADMIN_PASSWORD in dev.env)
pnpm --filter @open-macaron/controller gen:bifrost   # Bifrost admin client, when bumping the Bifrost image
pnpm --filter @open-macaron/controller db:generate   # after changing src/db/schema.ts
pnpm --filter @open-macaron/controller db:check
```

Integration tests (`controller-integration`) need a container runtime (Testcontainers). Without one locally they fail to start; CI runs them. With rootless Podman: `DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock TESTCONTAINERS_RYUK_DISABLED=true` (if the socket file is missing, `systemctl --user restart podman.socket`).

## Code rules (enforced by lint and review)

- **Strict TypeScript, no casts.** `consistent-type-assertions: never` applies to tests too (no `as`, no `as const`). Validate unknown data with Zod (`schema.parse(data)`), type it `unknown` first if a library returns `any`.
- **Maintained libraries over hand-rolled code.** Look for one before writing a parser, a client or a protocol. Prefer clients generated from OpenAPI over guessed contracts.
- **Dependencies** go in the `catalog:` of `pnpm-workspace.yaml`, pinned. `minimumReleaseAge` is 3 days: a version younger than that fails the install, so pick the newest that has matured.
- **Comments** explain why, at the density of the surrounding code. No narration of what the code does.
- **`process.env`** is read only in the validated env modules (`config/env.ts`, `agent-cli/src/inputs.ts`).

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
- **Secrets are never printed, logged or committed.** Scripts read them from `~/.config/macaron/dev.env` without echoing; the VPS gets them through `deploy/scripts/provision-secrets.sh` over ssh stdin.
- **Nothing from a pull request's checkout is executed in a privileged context** (open-macaron/knowledge `merge.yml`; environments that run code only on trusted branches).

## Release and deploy

1. Push to `main` (small semantic commits). CI (`ci.yml`) must be green; a network flake pulling base images is retried, not ignored.
2. `release.yml` builds the controller image; `release-agent-cli.yml` and `release-knowledge-cli.yml` publish the CLI bundles. Each has a build provenance attestation. `release-review.yml` publishes `@open-macaron/review` to npm (trusted publishing) when `packages/review`'s version changes, once the repository variable `NPM_PUBLISH` is `true`.
3. **Verify before pinning:** `gh attestation verify` on the image digest / bundle (signer workflow on `refs/heads/main`, source digest = the commit).
4. Pin: the image digest in `deploy/quadlets/macaron-controller.container`; the agent-cli URL and sha256 in open-macaron/runner `run.yml`; the knowledge-cli URL and sha256 in open-macaron/knowledge workflows (a platform PR there: `.github/` is never auto-merged).
5. Deploy **only over ssh**: `ssh open-macaron-vps 'sudo bash /opt/macaron/repo/deploy/scripts/deploy.sh'`. Never run host operations locally. If ssh says `Permission denied (publickey)` with `SSH_AUTH_SOCK` unset, the key is in the desktop agent: `export SSH_AUTH_SOCK=/run/user/$(id -u)/gcr/ssh`.
6. Check the result live (status comment, run, review/PR, cost settlement) on the sandbox repositories in `config/`, never on repositories outside it.

## Pitfalls already met

- `msw` in integration tests must start **after** Testcontainers (or bypass unknown hosts): it intercepts the container runtime's HTTP calls.
- A merge by the knowledge repository's `GITHUB_TOKEN` fails (403) when the branch is behind `main` on `.github/workflows/`.
- GitHub user-attachments: the upload endpoint needs write access to `repository_id` (404 otherwise) and an asset is private until a saved comment references it.
- Claude Code's `--json-schema` only knows draft 7: no `$schema` key.
- Bifrost: a model without a price is charged $0 (prices are pinned in `deploy/bifrost/pricing.json`); budgets and per-key rate limits are counted after requests, so only the provider-wide concurrency cap bounds a burst; empty lists come back as `null`; virtual keys need `key_ids: ["*"]` to use the provider's keys.
- Caddy's `path` matcher ignores case and cleans the path: rewrite matched requests to their canonical upstream path rather than forwarding the client's.
- VPS quadlets use `UserNS=auto`: a container can get another host ID range each time it starts, so a named volume needs `:U` (Caddy once lost its certificates that way, and every TLS handshake failed).
