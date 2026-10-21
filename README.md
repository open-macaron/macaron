# macaron

`macaron-bot` is an AI contributor for open-source projects. Mention it on an issue and it plans, answers or opens a pull request; review that pull request and it addresses the review. It works like any outside contributor: it never has access to the repositories it helps, it works from forks, and every action is paid for by a budget-capped key and reported in the pull request.

> Status: early development. Running on a sandbox repository only.

## What the bot can do

Only trusted users of trusted repositories (`config/`) can trigger it. Anyone else is ignored: no reaction, no reply, no cost. It answers with 👀 within a minute, then 👍 or 😕, and answers each request where it was asked: a status comment with a link to its run, edited until the run's cost settles. `implement`, `plan` and `reproduce` work from an issue; `verify` and `review` on a pull request.

| Comment | What happens |
|---|---|
| `@macaron-bot implement` | Implements the issue and opens a draft pull request from its fork |
| `@macaron-bot plan` | Posts an implementation plan, changes nothing |
| `@macaron-bot review` | On a pull request: checks the changes against the rules of [open-macaron/knowledge](https://github.com/open-macaron/knowledge) and posts one review, a table with one row per rule (✅ valid, ⚠️ warning, ❌ violation, ➖ ignored) and an inline comment on each violation |
| `@macaron-bot reproduce` | Tries to reproduce a reported problem with the repository's own tooling, with the commands it ran and their output, and screenshots or videos where its environment can show the application |
| `@macaron-bot verify` | On a pull request: checks that the change does what it should (what you ask, or what the pull request describes), the same way |
| `@macaron-bot triage` | Decides what a request needs: an answer, or one of the above |
| `@macaron-bot retry` | Runs the last failed or stopped loop again |
| `@macaron-bot stop` | Stops the running loop now |
| A bare mention | Same as `triage` |

**On its own pull requests,** no mention is needed: reviews from trusted users are addressed (code changes, a new commit, an answer in each review thread), and other comments are triaged.

**Reviews check one thing per rule.** A violation is only reported with a quote of a line the pull request adds; the reviewer reads code and history but can't change or run anything. The same review runs locally, before you push, with your own agent: `npx @open-macaron/review --project <project>` ([packages/review](packages/review/README.md)).

**Cost.** Every run has its own LLM key (OpenRouter, or a Bifrost gateway over a company key), capped at the mode's budget and limited to the run's models. The cost of each loop is reported: in a table at the end of the bot's pull requests, and in each review. Per-thread, per-repository and per-project monthly caps stop the bot before it spends more.

## How it works

- A **controller** on our own VPS holds every credential. It reads the bot's GitHub notifications, decides what to do, and does everything deterministic: budget keys, policy checks, commits, comments.
- **Agents** (Claude Code, Codex, opencode) run on throwaway GitHub-hosted runners in [`open-macaron/runner`](https://github.com/open-macaron/runner), with no GitHub credential and one LLM key capped at the run's budget.
- The agent's output goes through a **Gate** (paths, sizes, secrets, media types) before the controller publishes anything.

Read [docs/DESIGN.md](docs/DESIGN.md) first; [docs/SCALING.md](docs/SCALING.md), [docs/REPOSITORIES.md](docs/REPOSITORIES.md), [docs/ENGINEERING.md](docs/ENGINEERING.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) cover the rest.

## Repository layout

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas shared by the controller and the agent side (config, run context, run result, knowledge), emitted as JSON Schema |
| `packages/controller` | The NestJS controller |
| `packages/agent-cli` | `macaron-agent`, run on the runners: bootstrap, harness, result |
| `packages/review` | The review engine of `@macaron-bot review`, also the `macaron-review` CLI to run the same review locally ([README](packages/review/README.md)) |
| `packages/knowledge-cli` | Validation, owner-approved merges and the read API of open-macaron/knowledge |
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
