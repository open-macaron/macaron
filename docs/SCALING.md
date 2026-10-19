# macaron-bot — how the system scales

This doc covers how we go from 1 to ~30 repos and beyond, across projects that look nothing alike. A Podman Desktop extension and Podman Desktop itself are a good example of the range. It answers four questions: who defines a repo's environment, where configuration lives, who owns what, and which limits we hit first.

## 1. Environments: shared, own, or upstream-provided

**Constraint.** The setup has to run **in the same job** as the agent, because a job is one machine. A per-repo *workflow* can't do that: a separate workflow or job runs on another VM, and a reusable workflow call can't add steps around the agent. A per-repo *composite action* can. GitHub resolves a local action (`uses: ./path`) when the step runs, from whatever is in the workspace at that moment. So one fixed `run.yml` can load a different environment for each repo.

```
 open-macaron/runner  run.yml  (the only workflow; reviewed by maintainers; can't be altered per repo)
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 │ runs-on: ${{ inputs.runs-on }}            permissions: { id-token: write } only              │
 │  1 checkout upstream @ base SHA (+ fork branch)                                               │
 │  2 resolve environment ──┬─ shared   → copy runner/environments/<name>/        → ./.macaron/env │
 │                          ├─ own      → copy runner/environments/repos/<o>/<r>/ → ./.macaron/env │
 │                          └─ upstream → copy <upstream>@base:.github/macaron/env → ./.macaron/env │
 │  3 uses: ./.macaron/env   with: { params: ${{ inputs.env-params }} }   ← per-repo code runs here │
 │  4 bootstrap (OIDC → key + context)       ← after setup: the key is never handed to env code      │
 │  5 harness → 6 validate result → 7 upload artifact                                            │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Source | Lives in | Owned by | Best for |
|---|---|---|---|
| **shared** | `runner/environments/<name>/action.yml` + `params` from config | Platform maintainers | Fleets of similar repos: Podman Desktop extensions, generic Node/Python/Go via `mise` |
| **own** | `runner/environments/repos/<o>/<r>/action.yml` | That repo's team (CODEOWNERS on the folder) | Complex repos whose upstream hasn't adopted macaron |
| **upstream** | `<upstream>/.github/macaron/env/action.yml` at the **base SHA** | The upstream maintainers | Repos that want their environment versioned with their code, e.g. Podman Desktop |

**Why `upstream` is the best long-term option.** The environment changes in the same commits as the code: a pnpm or Electron bump updates both together, and old release branches keep a matching environment. It is always read from the upstream base SHA, never from the bot's branch, so the agent can't change the environment of its own next run.

**What this keeps safe:**
- If environment code redeems the ticket itself, the real bootstrap gets a 409 and the controller revokes the key at once. The worst case is a failed run, never a leaked credential.
- `permissions`, the bootstrap, the harness and the upload stay in `run.yml`. No environment source can change them.
- Environment code runs **before** bootstrap, in a job with no secrets.
- The org's Actions policy (allow-list, full-SHA pinning) also applies to every `uses:` inside an environment, including an upstream-provided one.
- The OIDC check stays simple: `workflow_ref` must be `open-macaron/runner/.github/workflows/run.yml@refs/heads/main`.

**What a composite can't do, and the workaround:**
- `services:` → start containers with `podman run` in a step.
- `container:` → the `devcontainer` shared environment runs the agent through the devcontainer CLI.
- `runs-on` → a dispatch input, set from config.

### Example: Podman Desktop and its extensions

```yaml
# runner/environments/pd-extension/action.yml (shared)
inputs: { params: { required: true } }      # JSON: { host, hostRef }
runs:
  using: composite
  steps:
    - uses: actions/checkout@<sha>           # host app next to the extension
      with: { repository: "${{ fromJSON(inputs.params).host }}", ref: "${{ fromJSON(inputs.params).hostRef }}", path: .macaron/host }
    - uses: jdx/mise-action@<sha>            # Node/pnpm versions from the extension's own files
    - run: pnpm -C .macaron/host install --frozen-lockfile && pnpm install --frozen-lockfile
      shell: bash
```

`hostRef: auto` can resolve the ref from the extension's `engines` field in `package.json`, so each extension builds against the Podman Desktop version it declares.

Podman Desktop itself uses `source: upstream`. Its maintainers keep `.github/macaron/env/action.yml` next to their own CI, including Electron dependencies, Xvfb and Podman.

## 2. Configuration: a hierarchy, not one `trust.yaml`

One flat file doesn't scale in either direction. Every team would edit the same file, and every extension would repeat the same 15 lines. `config/` in `open-macaron/macaron` becomes a tree, merged **global → project → repo**, with the most specific value winning:

```
config/
├── global.yaml                          defaults: harness, model, mode budgets, caps, concurrency
└── projects/
    ├── podman-desktop/
    │   ├── project.yaml                 users, bots, monthly budget, default environment, CODEOWNERS team
    │   └── repos/
    │       ├── podman-desktop.yaml      environment: { source: upstream }, runs-on, budget overrides
    │       ├── extension-a.yaml         {}                     ← inherits pd-extension from the project
    │       └── extension-b.yaml         environment: { params: { hostRef: v1.22.0 } }
    └── <other-project>/…
```

```yaml
# config/projects/podman-desktop/project.yaml
project: podman-desktop
owners: "@open-macaron/podman-desktop"          # CODEOWNERS for this folder
users: [alice, bob]                             # who may trigger, across the project's repos
bots: [coderabbitai[bot]]
budget: { month: 300.00, perThread: 20.00 }
concurrency: 4
defaults:
  environment: { source: shared, name: pd-extension, params: { host: podman-desktop/podman-desktop, hostRef: auto } }
  runs-on: ubuntu-24.04
```

```ts
// packages/contracts — the merged result the controller works with
interface RepoConfig {
  repo: `${string}/${string}`; project: string;
  environment: { source: "shared" | "own" | "upstream"; name?: string; params: Record<string, string> };
  runsOn: string; harness: Harness; model: string;
  commands: { build?: string; test?: string; lint?: string };   // used by env-check and given to the agent
  capabilities: readonly ("gui" | "video" | "container")[];   // proven by env-check; gates reproduce/verify
  contribution: { dco: boolean; cla?: string; fixCi: boolean };   // outside-contributor requirements (DESIGN.md)
  budgets: Record<Mode, number>; caps: Caps;
  users: readonly string[]; bots: readonly string[];
}
```

**The project is the unit we "don't work for free" for.** It has a budget, a list of trusted users and a concurrency share. Costs roll up repo → project → global in the ledger and the reports.

**Who owns what:**
- CODEOWNERS gives each project team its own folder.
- The platform team owns `global.yaml` and must approve any change to `budget`, `users` or `runs-on`. CI flags those fields in the PR.

## 3. Knowledge follows the same hierarchy

```
knowledge/
├── global/                       rules for every repo; how macaron works; harness tips
├── projects/podman-desktop/      shared by every repo in the project: rules, extension API, review culture
└── repos/<o>/<r>/                repo specifics: rules, build quirks, flaky tests, reviewer preferences
```

Each folder has its own `OWNERS.yaml`: a project's maintainers approve changes to their rules and lessons without write access to the repository (DESIGN.md §6.4).

Before all of these, the agent reads the upstream's own `AGENTS.md` / `CLAUDE.md`, which harnesses load natively. Our knowledge only holds what upstream doesn't say. Lessons that recur across extensions get promoted from `repos/` to `projects/` by the weekly `garden` run, so an extension learns from its siblings.

## 4. Keeping environments healthy: `env-check`

An environment rots silently: a toolchain bump, or a host ref that moved. The bot would only find out mid-run, paying for tokens. `runner/.github/workflows/env-check.yml` runs steps 1–3 of `run.yml`, followed by the repo's build and test commands, **with no agent and no key**:
- **on every PR to `runner`**, for the environments it touches, so a shared environment change is tested against all of its repos;
- **nightly**, for every active repo;
- **on a config PR** in `macaron`, by dispatch, for the repos it touches.

**Speed first.** The agent job does independent setup work in parallel: `macaron-agent prepare` clones the upstream at the base commit, fetches the fork branch and installs the pinned harness CLI concurrently. Only the environment step, which needs the checkout, waits. Triage runs skip the environment entirely. Dependency caching is a later optimisation: we will add it once we've decided how to keep a run from poisoning the cache that the next run restores.

A red env-check pauses the repo. The controller answers "environment broken, maintainers notified" instead of spending a budget on it.

## 5. Onboarding becomes self-service

```
 project team: PR to macaron  config/projects/<p>/repos/<r>.yaml   (+ environment if own/upstream)
   CI: schema ✓  upstream public ✓  environment exists ✓  env-check dispatched ✓  budget/users diff flagged
   review: project CODEOWNERS (+ platform team if budget/users/runs-on changed)
 merge → maintainer runs onboard-repo.sh (fork, Actions off) → deploy.sh delivers config → live
```

The platform team only reviews money and trust. Everything else is owned by the project.

## 6. Which limits we hit first

| Limit | Order of magnitude | Mitigation |
|---|---|---|
| **Reviewer attention** | The real bottleneck: humans review ~a few bot PRs per day per repo | WIP limit per repo (max open bot PRs, default 3). New `implement` requests queue with a visible position in the status comment |
| Actions concurrency | Per org plan (e.g. 20 jobs; macOS lower) | Controller queue with global and per-project shares, fair scheduling across projects, interactive (`triage`) before batch (`implement`) |
| LLM spend (OpenRouter or Bifrost) | Bounded by keys and budgets | Per-project monthly budgets; the Router keeps chit-chat at ~$0.001 |
| GitHub API rate limits | 5,000 req/h per token | Conditional requests (304s are free), ETag caches, batched GraphQL for thread snapshots. About 50 calls per loop means roughly 100 loops/h per token before it matters |
| Controller | One VPS | Stateless besides Postgres; a second instance is possible because pg-boss and the migration lock coordinate through Postgres. Unlikely to be needed before ~1,000 loops/day |
| One bot identity | All projects share `macaron-bot` | Later, a project can bring its own identity (`<project>-bot`) with its own tokens; `RepoConfig` gains an `identity` field and the GitHub clients become per-identity |

## 7. What changes in the other docs

- `runner` holds one `run.yml`, `environments/` and `env-check.yml`. The `run-<profile>.yml` files are gone.
- `config/trust.yaml` becomes `config/` (§2).
- `knowledge` gains a `projects/` level (§3).
