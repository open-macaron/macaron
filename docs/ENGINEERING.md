# macaron-bot — engineering guidelines

How the controller and the agent-side CLI are built. The system design is in [DESIGN.md](DESIGN.md); deployment and the supply chain are in [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS | Same major in the container (`ubi10/nodejs-24-minimal`) and in CI |
| Framework | NestJS 12, **ESM** | All Nest packages ship as ESM |
| Language | TypeScript 6.0 | The version `nest upgrade` targets. TS 7 (`tsgo`) can be added as a faster `--noEmit` check once Nest's CLI supports it |
| Queues | pg-boss 12 | Same Postgres, no extra service; LISTEN/NOTIFY for immediate pick-up |
| Database | PostgreSQL 18 (`rhel10/postgresql-18` StatefulSet with TLS from the service CA; `postgres:18-alpine` in tests), **Drizzle ORM v1** + `@nestjs/drizzle` + `pg` | Drizzle 1.0 is still `rc`, as used by the Nest docs. Pin the exact version and move to GA when it ships |
| Validation | Zod 4, through **Nest 12's native Standard Schema support** | `@Body({ schema })` + `StandardSchemaValidationPipe` validate requests; `@nestjs/swagger` 12 builds OpenAPI from the same schemas (`@ApiResponse({ standardSchema })`). There is no `@nestjs/zod` package, and `nestjs-zod` v5 only supports Nest ≤ 11, so we use no third-party bridge. Zod also validates every non-HTTP input: env, webhooks, notifications, OIDC claims, `config/**`, `result.json` |
| GitHub | `@octokit/rest` + `plugin-throttling` + `plugin-retry`, `@octokit/webhooks-methods` | Octokit is generated from GitHub's own OpenAPI spec. One client per token, see §4 |
| HTTP clients | Official SDKs first, otherwise `@hey-api/openapi-ts` | Every client is **generated from an OpenAPI spec**, never handwritten (§5). Bifrost's admin API: generated from its OpenAPI document at the pinned release. OpenRouter: `@openrouter/sdk`, which OpenRouter generates from its own spec (standalone functions, Zod-validated responses, typed `Result` errors) |
| OIDC | `jose` | JWKS from `token.actions.githubusercontent.com`, cached |
| Infra libs | `nestjs-pino` (JSON logs, secrets redacted), `@nestjs/terminus` (probes), `nestjs-cls` (request/run correlation id) | |
| Tests | Vitest 5, `@nestjs/testing`, Testcontainers (Postgres), `msw` (GitHub and Bifrost HTTP) | Vitest is the default for ESM projects in Nest 12 |
| Prefer libraries | maintained packages over hand-rolled code | `file-type` (media sniffing), `secretlint` (credentials), `mdast-util-from-markdown` + GFM (mentions, sanitising), `markdown-table`, `@sindresorhus/slugify`, `p-retry`, `deepmerge-ts`, `@octokit/webhooks`, pg-boss. We keep our own code only for policy (Gate, caps) and GitHub-specific pacing |
| Web app | SvelteKit 3 (`adapter-node`), Svelte 5 runes, Tailwind 4, shadcn-svelte | `packages/web`. Components come from the shadcn-svelte CLI (vendored in `src/lib/components/ui`, never edited by hand). Configuration is `src/env.ts` (`defineEnvVars`, Zod). The app owns its CSP (`vite.config.ts`) |
| Package manager | pnpm 12 workspace | `--frozen-lockfile`, lifecycle scripts denied except where allow-listed, `minimumReleaseAge` set to 3 days |

## 2. Repository layout

```
macaron/                                (open-macaron/macaron, public)
├── packages/
│   ├── controller/                     NestJS service, see §3
│   ├── contracts/                      Zod schemas (RunContext, RunResult, config, knowledge) → also emitted as JSON Schema; `parseConfigTree`
│   ├── agent-cli/                      `macaron-agent` used inside runner's `run.yml`: bootstrap (OIDC) → harness (`src/harness.ts`) → validate → upload
│   ├── review/                         review engine shared by controller and agent-cli; `macaron-review` CLI on npm
│   ├── owners/                         owner-approved merges (OWNERS.yaml per folder), shared by the two CLIs below
│   ├── knowledge-cli/                  open-macaron/knowledge: validate, merge, build the Pages read API
│   ├── config-cli/                     open-macaron/config: validate (the controller's checks), merge, build the Pages snapshot
│   └── web/                            SvelteKit app: GitHub sign-in, users' LLM keys, usage history (talks to the controller only)
├── deploy/                             openshift/ (manifests, scripts), bifrost/ (config, prices, dev.sh), see DEPLOYMENT.md
├── .github/workflows/                  ci.yml, release.yml  (agent workflows live in open-macaron/runner)
└── docs/
```

`packages/contracts` and `packages/review` are the only code shared by both sides of the trust boundary; `review` holds pure functions, git and the read-only harness session, no credential. The controller never imports `agent-cli`, and `agent-cli` never imports the controller.

## 3. Controller modules

The modules are declared in `src/modules.ts`, wired in `AppModule` with `EnvModule` (validated env), `DbModule` (Drizzle) and `GitHubModule` (one Octokit client per token).

```mermaid
flowchart LR
  HTTP["HttpModule<br/>Bootstrap, Webhook, Health controllers"] --> RUNS
  ING["IngestModule<br/>NotificationsPoller, IngestService,<br/>ThreadWorker, ContextBuilder, ThreadStates"] --> RUNS
  RUNS["RunsModule<br/>RunLauncher, OidcVerifier,<br/>ArtifactDownloader, Housekeeping"] --> BUD["BudgetModule<br/>RunKeysRegistry (BifrostKeys, OpenRouterKeys),<br/>BudgetService"]
  RUNS --> PUB["PublishModule<br/>Publisher, ForkCommitter, UpstreamWriter,<br/>ReactionTargets, EvidenceHost, KnowledgeProposer"]
  RUNS --> REV["ReviewModule<br/>KnowledgeClient, PullDiffReader"]
  ING --> PUB
  ING --> REV
  CORE["CoreModule (global)<br/>RepoConfigService, PublishedConfigClient, ConfigSnapshotStore, ConfigUpdates,<br/>Jobs, BotIdentity, RunsRepository, EventsRepository, PollStateStore"]
  HTTP --> ACC["AccountsModule<br/>SessionsService (better-auth), InvitationsService,<br/>UsersService, UsageService"]
```

- **Routing is plain code, not a module.** `src/routing/routes.ts` (`ROUTES`, `route()`, subjects) is pure and table-tested; `ThreadStates` reads what it needs from GitHub and the ledger, and `ThreadWorker` applies it (DESIGN.md §4 "Subjects and routes").
- **Dependencies point one way:** HTTP and ingest → runs → budget, publish, review. Each module exports only what its users need. Nothing enforces the direction automatically yet; reviews do.
- **State lives in Postgres, not in memory.** Background work runs on [pg-boss](https://github.com/timgit/pg-boss), on the same database: per-thread debounce (`upsert` on a `stately` queue moves the pending job back), deduplicated `run-completed` jobs, and cron-scheduled `reconcile` and `sweep-keys`. The notifications poller is itself a pg-boss job (see DESIGN.md §4), so a restart loses nothing.
- **Idempotency.** Every external effect (reaction, comment, push, dispatch) is keyed in the database by `(thread, loop, effect)`. A retried job never double-posts.

Drizzle tables (`packages/controller/src/db/schema.ts`):

```ts
export const pollState       = pgTable("poll_state",       { /* singleton: Last-Modified, interval, notBefore — the poller's pacing */ });
export const configSnapshots = pgTable("config_snapshots", { /* commit, files — each published configuration applied, the boot fallback */ });
export const threads    = pgTable("threads",    { /* repo, number, kind, branch, prNumber, cursor, loops, spentUsd */ });
export const events     = pgTable("events",     { /* threadId, sourceId, author, kind, dueAt, claimedAt, status */ });
export const runs       = pgTable("runs",       { /* ticket, threadId, mode, ghRunId, keyHash, limitUsd, costUsd, status */ });
export const ledger     = pgTable("ledger",     { /* runId | routerCallId, usd, at — append-only */ });
export const effects    = pgTable("effects",    { /* threadId, loop, kind, externalId — idempotency */ });
// Users (the web app), better-auth's tables hand-owned: users (githubId, githubLogin, role, capabilities),
// sessions, accounts (no OAuth token kept), verifications; then invitations and admin_audit (append-only).
export type Run = typeof runs.$inferSelect;
```

`events.author_id` and `runs.trigger_github_id` record who asked for a run by GitHub id (retries and escalations keep the first run's): what `/v1/me/usage` lists.

Migrations are generated with `drizzle-kit generate` and committed. They run at application start, before any provider can query: the Drizzle module's factory migrates under a Postgres advisory lock, then hands out the database. Nobody runs a migrate command by hand.

## 4. Capability-scoped GitHub clients

Least privilege also applies inside the codebase. Each token has its own injection token, and only the modules listed below inject it (checked in review; no lint rule enforces it yet):

```ts
export const GH_INTERACT = Symbol("GH_INTERACT"); // comments, reactions, PRs, notifications — Ingest, Publish
export const GH_ORG      = Symbol("GH_ORG");      // runner: dispatch/cancel/artifacts; knowledge: PR — Runs, Publish
export const GH_PUSH     = Symbol("GH_PUSH");     // git push to forks — Publish only

@Injectable()
export class Publisher {
  constructor(@Inject(GH_PUSH) private readonly push: ForkPusher,
              @Inject(GH_INTERACT) private readonly gh: Octokit) {}
}
```

## 5. Contracts and code generation

No client guesses a contract. Each contract has one source of truth, and everything else is generated from it:

```mermaid
flowchart LR
  subgraph SRC["Sources of truth"]
    Z["packages/contracts<br/>Zod schemas"]
    ORS["@openrouter/sdk<br/>(generated by OpenRouter from its spec)"]
    BFS["Bifrost OpenAPI<br/>(pinned to the deployed release)"]
    GHS["GitHub OpenAPI<br/>(via Octokit)"]
  end
  Z -- "@Body({ schema }), @ApiResponse({ standardSchema })" --> NEST["Controller routes<br/>/bootstrap, /webhook"]
  NEST -- "pnpm --filter @open-macaron/controller gen<br/>(SwaggerModule.createDocument, no server)" --> SPEC["packages/contracts/openapi/controller.json"]
  SPEC -- "@hey-api/openapi-ts" --> AC["agent-cli: generated client<br/>+ Zod response validation"]
  ORS --> ORC["controller: OpenRouterKeys"]
  BFS -- "@hey-api/openapi-ts<br/>(pnpm gen:bifrost)" --> BFC["controller: BifrostKeys<br/>types + Zod response validation"]
  Z -- "z.toJSONSchema()" --> JS["result.schema.json, context.schema.json<br/>(published with agent-cli; in the agent prompt)"]
  GHS --> OCT["controller: Octokit"]
```

- **HTTP between our components** (`/bootstrap`): the controller is the source of truth. Its OpenAPI document is generated at build time without starting a server. `agent-cli`'s client is generated from it, and that client validates responses with Zod, so a mismatch fails loudly instead of being cast through.
- **Files between the agent and us** (`context.json`, `result.json`): Zod in `packages/contracts`, exported as JSON Schema. The agent gets the schema in its prompt and produces the file with `macaron-agent` commands.
- **Third parties:**
  - OpenRouter: the official `@openrouter/sdk`, generated by OpenRouter from its OpenAPI spec. We don't generate our own: an earlier attempt hit generator bugs and a defect in their published spec.
  - Bifrost: types and Zod schemas generated with `@hey-api/openapi-ts` from Bifrost's OpenAPI document, at the commit of the image pinned in `deploy/openshift/bifrost.yaml`, filtered to the admin operations `BifrostKeys` uses (`openapi-ts.bifrost.config.ts`). Responses are parsed with picks of the generated schemas, so unrelated fields can change. Regenerate with `pnpm --filter @open-macaron/controller gen:bifrost` when bumping the image; CI doesn't, because the input is remote.
  - GitHub: Octokit, whose types are already generated from GitHub's spec.
- **Generated code is committed** under `src/generated/`, excluded from lint and coverage, so reviews show contract changes. CI regenerates the JSON Schemas, the OpenAPI document and agent-cli's client, then fails on any `git diff` in them (the Bifrost client is regenerated by hand, when bumping Bifrost).

## 6. TypeScript and lint rules

`tsconfig.base.json`, shared by every package:

```jsonc
{
  "compilerOptions": {
    "target": "es2024", "module": "nodenext", "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true, "noImplicitReturns": true, "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "isolatedModules": true, "forceConsistentCasingInFileNames": true, "skipLibCheck": false,
    "experimentalDecorators": true, "emitDecoratorMetadata": true   // required by Nest DI
  }
}
```

ESLint 10 flat config uses `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, with these rules on top:

- `no-explicit-any`, `no-non-null-assertion`, `no-floating-promises`, `switch-exhaustiveness-check`, `explicit-module-boundary-types` — all as errors.
- `consistent-type-assertions: never`: no `as`, tests included.
- `no-restricted-syntax` on `process.env`, allowed only at the env entry points (with an `eslint-disable`).
- `consistent-type-imports` configured for decorator metadata.
- For `.svelte` and `.svelte.ts` files, the same typed rules plus `eslint-plugin-svelte`'s `recommended` set and the stricter rules it leaves opt-in (it has no `strict` preset): `block-lang` (TypeScript only), `button-has-type`, `no-target-blank`, `require-each-key`, `no-inline-styles`, `no-at-html-tags` and others, in `eslint.config.js`.

Code conventions:
- **Parse, don't trust.** Data from GitHub, Bifrost, OpenRouter, OIDC or the agent artifact is `unknown` until a Zod schema has parsed it. No `as` casts on external data.
- **Domain errors are typed classes** (`BudgetExceeded`, `PolicyViolation`, `TicketAlreadyRedeemed`). Exception filters map them to HTTP responses at the edge only.
- **Branded ids**, for example `type Ticket = string & { readonly __brand: "Ticket" }`, so a ticket, a key hash and a run id can't be mixed up.
- **No `process.env` outside the env entry points** (the controller's `EnvModule`, agent-cli's `inputs.ts`, the CLIs' `cli.ts`). Configuration is a parsed Zod object, and the service fails fast at boot if it is invalid.
- **Logs never contain secrets.** Pino redact paths cover tokens, keys and `Authorization` headers, and a unit test asserts it.

## 7. Tests

- **Unit tests** (`test/unit/`) cover `NotificationsPoller` against a fake clock (see below), the `Gate` (workflow files, secrets, binaries, oversize, review evidence), Markdown sanitizing and the cost table, `OidcVerifier` (forged, expired and wrong-repository tokens), the env schema, the published configuration (`PublishedConfigClient`, `RepoConfigService`; the config tree itself is tested in `packages/contracts`), `ROUTES` (every subject × mode, exact refusal messages), the key backends (`BifrostKeys` against `msw`, backend routing in `BudgetService`), settlement and reaction targets.
- **Integration tests** (`test/integration/`) run against a Testcontainers Postgres: loop numbering, effects at most once, event dedupe, pg-boss debounce, effect claiming, and the evidence host with `msw` standing in for GitHub. Locally they need a container runtime; with rootless Podman, point Testcontainers at its socket (`DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock`, `TESTCONTAINERS_RYUK_DISABLED=true`).
- **Live tests** (`test/live/`, `pnpm test:live`) hit the real services with the developer's `dev.env`, each skipped without its variables: Bifrost (against `deploy/bifrost/dev.sh up`), OpenRouter, evidence uploads.
- **Not covered yet:** the `Publisher` (its dependencies can't be faked without casts) and the full loop from notification to publish; both are checked live on the sandbox repositories.
- **Contract tests** check that `packages/contracts` round-trips the recorded fixtures of real payloads (notifications, webhooks, `result.json` from each harness).
- **Poll-interval tests.** The poller must never issue a request before `notBefore`. The tests check that:
  - an interval going from 60 to 300 s is obeyed immediately, including when it arrives on a 304;
  - a missing header keeps the last interval;
  - after a restart, the persisted `notBefore` is respected;
  - two instances produce one poller;
  - 403/429 with `Retry-After` waits at least that long;
  - an error burst never polls faster than the interval.
- **Web tests** (`packages/web/test/`, project `web`) run with the app's own Vite config (the SvelteKit plugin, not SWC).
- **Web end-to-end tests** (`packages/web/e2e/`, Playwright, `pnpm --filter @open-macaron/web test:e2e`) drive the production build in Chromium through a stand-in for the edge (`/api/auth` to the controller, the rest to the app) against a fake controller. The fake checks every request and answer against the Zod schemas generated from the OpenAPI document, so it can't drift from the real API; each test also fails on any browser console error (CSP violations included). Remote functions can't be faked at the component level without casts: the forms are tested this way, through the real app.
- **Coverage** is measured (`@vitest/coverage-v8`, generated code excluded) but not gated yet.

## 8. CI gates (`ci.yml`, required on `main`)

1. `pnpm install --frozen-lockfile`; on pull requests, `changeset status --since=origin/main` (a changeset, or an empty one, for any package change: .changeset/README.md).
2. `build`, `typecheck`, `lint`, `test` (unit and integration; live tests skip without credentials).
3. Generated code drift check (§5) and `drizzle-kit check` (migrations consistent with the schema).
4. Container builds of the controller and the web app (`image` job, buildah), without pushing (pushing happens in `release.yml`, DEPLOYMENT.md §1).

Actions are pinned by full SHA and bumped by hand. Wanted, not wired yet (#39): `actionlint` and `zizmor` on the workflows, Renovate, `knip`, `dependency-cruiser`, `gitleaks` and an image scan.

Conventional commits. `main` has a ruleset: a PR for every change, the `check` and `image` jobs required, no bypass. Approvals aren't required (one maintainer can't approve their own PRs); the Version Packages PR merges itself once CI is green.

## 9. Running the web app locally

Signing in on a developer machine uses the same code as production: no dev-only route, session or flag. The browser sees one https origin, the Vite dev server (`@vitejs/plugin-basic-ssl`, a self-signed certificate to accept once), which proxies `/api/auth` to a local controller as the edge does. The controller runs on a throwaway database with `MACARON_ENABLED=false`: it polls no notifications and launches no run. It still reads GitHub at start, to verify the bot's tokens, and resolves logins when you invite someone. Its hourly sweep acts on the configured key backends, so it only ever gets the local Bifrost below, never OpenRouter or production's.

1. **A development GitHub App**, once, owned by you, never the production one: Settings → Developer settings → GitHub Apps → New.
   - Homepage URL `https://localhost:5173`, callback URL `https://localhost:5173/api/auth/callback/github`.
   - "Request user authorization (OAuth) during installation" off, webhook off.
   - Permissions: Account → Email addresses, read-only. Nothing else.
   - Generate a client secret.
2. **Bifrost and a throwaway Postgres:**

   ```sh
   deploy/bifrost/dev.sh up
   podman run -d --rm --name macaron-web-dev-postgres -p 127.0.0.1:15432:5432 \
     -e POSTGRESQL_USER=macaron -e POSTGRESQL_PASSWORD=macaron -e POSTGRESQL_DATABASE=macaron \
     quay.io/sclorg/postgresql-18-c10s
   mkdir -p ~/.config/macaron/llm-kek && (umask 077; openssl rand -hex 32 > ~/.config/macaron/llm-kek/v1)
   ```

3. **The controller's environment**, in its own file, `~/.config/macaron/web-dev.env` (mode 0600). Copy `GH_INTERACT`, `GH_PUSH`, `GH_ORG`, `RUNNER_REPO`, `RUNNER_REPO_ID`, `RUNNER_OWNER_ID`, `WEBHOOK_HMAC` and `BIFROST_ADMIN_PASSWORD` from `dev.env`, then add the following. Leave every `OPENROUTER_*` variable out.

   ```sh
   PUBLIC_URL=https://localhost:5173
   DATABASE_URL=postgres://macaron:macaron@127.0.0.1:15432/macaron
   MACARON_ENABLED=false
   CONFIG_DIR=<repository>/packages/contracts/test/fixtures/config
   LLM_BACKEND=bifrost
   BIFROST_ADMIN_URL=http://127.0.0.1:18080
   BIFROST_PUBLIC_URL=https://localhost:18443/llm/anthropic
   LLM_PRICING_FILE=<repository>/deploy/bifrost/pricing.json
   LLM_KEK_DIR=<home>/.config/macaron/llm-kek
   BETTER_AUTH_SECRET=<openssl rand -hex 32>
   GITHUB_LOGIN_CLIENT_ID=<the development app's client id>
   GITHUB_LOGIN_CLIENT_SECRET=<its client secret>
   MACARON_ADMIN_USER_IDS=<your GitHub id: gh api user --jq .id>
   LLM_ENDPOINT_DEFAULTS=[{"name":"Anthropic API","baseUrl":"https://api.anthropic.com"}]
   ```

4. **Run both**, then open `https://localhost:5173`:

   ```sh
   MACARON_ENV_FILE=~/.config/macaron/web-dev.env pnpm --filter @open-macaron/controller dev
   cp packages/web/.env.example packages/web/.env.local   # CONTROLLER_URL=http://127.0.0.1:8080
   pnpm --filter @open-macaron/web dev
   ```

   You sign in as an admin. Saving a key checks it with its endpoint, as in production. No run starts locally: mentions aren't polled.
5. **Tear down:** `podman rm -f macaron-web-dev-postgres` (the database is gone with it) and `deploy/bifrost/dev.sh down`.
