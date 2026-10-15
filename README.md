# macaron

`macaron-bot` is an AI contributor for open-source projects. Mention it on an issue and it plans, answers or opens a pull request; review that pull request and it addresses the review. It works like any outside contributor: it never has access to the repositories it helps, it works from forks, and every action is paid for by a budget-capped key and reported in the pull request.

> Status: early development (milestone 1). Not running yet.

## How it works

- A **controller** on our own VPS holds every credential. It reads the bot's GitHub notifications, decides what to do, and does everything deterministic: budget keys, policy checks, commits, comments.
- **Agents** (Claude Code, Codex, opencode) run on throwaway GitHub-hosted runners in [`open-macaron/runner`](https://github.com/open-macaron/runner), with no GitHub credential and one OpenRouter key capped at the run's budget.
- The agent's output goes through a **Gate** (paths, sizes, secrets, media types) before the controller publishes anything.

Read [docs/DESIGN.md](docs/DESIGN.md) first; [docs/SCALING.md](docs/SCALING.md), [docs/REPOSITORIES.md](docs/REPOSITORIES.md), [docs/ENGINEERING.md](docs/ENGINEERING.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) cover the rest.

## Repository layout

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas shared by the controller and the agent side (config, run context, run result), emitted as JSON Schema |
| `packages/controller` | The NestJS controller |
| `config/` | Trusted projects, repositories, users and budgets |
| `docs/` | Design documents |

## Development

Requirements: Node.js 24, pnpm 12, and Docker or Podman for the integration tests.

```sh
pnpm install
pnpm check          # typecheck, lint, unit tests
pnpm test           # all tests (integration tests start a Postgres container)
```

With Podman, point Testcontainers at its socket: `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock TESTCONTAINERS_RYUK_DISABLED=true`.

To run the controller locally, copy `packages/controller/.env.example` to `~/.config/macaron/dev.env`, fill it in, and run `pnpm --filter @open-macaron/controller dev`.

## License

[Apache-2.0](LICENSE)
