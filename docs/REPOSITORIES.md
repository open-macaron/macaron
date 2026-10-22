# macaron-bot — organisation, repositories and accounts

The org [`open-macaron`](https://github.com/open-macaron) owns all of our repositories. The user `macaron-bot` owns **only forks** of upstream repos. It is the identity that opens PRs and comments.

## 1. Map

```
 github.com/open-macaron  (org, everything public)
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ macaron      controller + contracts + agent-cli + harness adapters + config + deploy + docs │──release──▶ ghcr.io/open-macaron/controller
│              CI, release.yml (images, agent-cli tarball, attestations)                    │             agent-cli-<v>.tgz (GitHub release)
│ runner       run.yml + environments/ + env-check.yml — where agents execute                │◀─ start / cancel runs (GH_ORG), artifacts (GH_INTERACT)
│ knowledge    rules + lessons; folder owners approve, merge.yml merges; Pages read API      │◀─ PR from macaron-bot/knowledge (GH_ORG)
│ .github      org profile, SECURITY.md, CONTRIBUTING.md, issue templates                   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
          runner repository webhook (workflow_run) ─────────────────────▶ controller /v1/webhook

 github.com/macaron-bot  (user, owns forks only)
┌──────────────────────────────────────────────┐   PR + replies (GH_INTERACT)   ┌─────────────────────────┐
│ <upstream-1> … <upstream-30>  (Actions off)  │──────────────────────────────▶│ upstream repos (org-x…)  │
│ knowledge                     (Actions off)  │──▶ open-macaron/knowledge     └─────────────────────────┘
└──────────────────────────────────────────────┘
          ▲ push (GH_PUSH: fine-grained, owner macaron-bot, all its repos = forks only)
```

## 2. Repositories

| Repo | Contents | Who writes | Why separate |
|---|---|---|---|
| `open-macaron/macaron` (this repo) | `packages/controller`, `packages/{contracts,agent-cli}`, `harness/`, `config/` (global → project → repo), `deploy/`, `docs/` | Humans via PR | Source of truth for code and trust config. `deploy/openshift/scripts/deploy.sh` applies a clean checkout of `main` |
| `open-macaron/runner` | `.github/workflows/run.yml` (the only agent workflow), `env-check.yml`, `environments/` (shared + own, CODEOWNERS per folder), plus a `README` describing the contract (SCALING.md §1) | Humans via PR; the bot only *dispatches* | Gives agent runs their own `repository_id` (the OIDC check pins it) and their own public run history. The token that dispatches runs can't trigger `macaron`'s `release.yml` |
| `open-macaron/knowledge` | `global/`, `projects/<p>/`, `repos/<owner>/<repo>/`, each with `OWNERS.yaml`, `rules/`, `lessons/` (DESIGN.md §6) | Humans write rules; the bot proposes lessons from its fork. Folder owners approve (no write access needed); `merge.yml` merges | High-churn, bot-authored content stays out of the code repo. Knowledge is versioned independently of controller releases |
| `open-macaron/.github` | Org profile, default community health files | Humans | GitHub convention |
| `macaron-bot/<prefix>-<upstream>` | Forks named with a random 6-character prefix (`sf465s-podman-desktop`), so two upstreams with the same name never collide; branches `macaron/<n>-<slug>` | The controller only (GH_PUSH) | User-owned forks keep **"Allow edits by maintainers"**, which org-owned forks don't support. They also make "all repos of macaron-bot" mean exactly "the forks" |

The current local `agent-runner` directory becomes `open-macaron/macaron`.

How `run.yml` gets the agent-cli:
- It downloads `agent-cli-<v>.tgz` from a `macaron` release, pinned by **version + sha256**.
- Renovate bumps the pin in `runner`. That PR's CI runs `gh attestation verify` against `macaron`'s `release.yml` before it can merge.
- The agent job therefore needs no permission beyond `id-token: write`.

## 3. Accounts and tokens

| Identity | Org role | Repo access |
|---|---|---|
| Humans | Team `maintainers` (owners: 2 people minimum) | `admin` on all org repos |
| `macaron-bot` | Member, team `bots` | `write` on `runner` only, needed for `workflow_dispatch`. Rulesets block it from creating or updating any ref there. Read elsewhere (public) |

| Token (in the controller's Secret) | Type and owner | Permissions | Used for |
|---|---|---|---|
| `GH_INTERACT` | classic PAT of macaron-bot | `public_repo`, `notifications` | Comments, reactions, PRs and notifications on **upstream** repos. The org blocks classic PATs, so this token can't touch `open-macaron/*` |
| `GH_PUSH` | fine-grained, owner `macaron-bot`, all repositories | Contents: write. Workflows: write | `git push` to forks only (macaron-bot owns nothing else), including `macaron-bot/knowledge`. Workflows only carries upstream's own workflow commits when a fork is synced or branched; the controller never writes `.github/` itself. No Administration permission. **Never enable Actions on a fork**: GitHub keeps them off on a new fork until its owner turns them on |
| `GH_ORG` | fine-grained, owner `open-macaron`, repositories `runner` and `knowledge`, approved by an org owner | `runner`: Actions read and write. `knowledge`: Pull requests read and write | Start and cancel runs; open and update the `remember:` proposals from `macaron-bot/knowledge` (the org blocks the classic `GH_INTERACT`). Artifacts use `GH_INTERACT` (public reads). A GitHub App could replace this token later, to avoid manual renewal |

Forking and disabling Actions on a fork happen at onboarding (§5). `GH_INTERACT` can do both, because the bot owns its forks; GitHub enables Actions on new forks, so onboarding must switch them off.

## 4. Org settings

- **Authentication:** 2FA required. Base permission: `read`. Members can't create repos or change visibility.
- **Personal access tokens:**
  - **classic PATs are blocked** for org resources;
  - fine-grained PATs are allowed **with owner approval**, with a maximum lifetime of 90 days.
- **Actions:**
  - only GitHub-owned actions and an allow-list, **pinned to full SHA** (org policy);
  - `GITHUB_TOKEN` defaults to read-only;
  - Actions can't create or approve PRs;
  - fork PR workflows from outside collaborators need approval.
- **Rulesets (org-level, all repos):**
  - default branch: PR required, 1 approval, CODEOWNERS review, required status checks, linear history, no force-push or deletion;
  - `v*` tags: created only via `release.yml`;
  - `runner`: no ref creation or update for anyone except `maintainers`.
- **Webhook:** a repository webhook on `runner` only, to `https://<controller-host>/v1/webhook`, HMAC secret, event `workflow_run`. Narrower than an org webhook. A `push` webhook on `knowledge` comes with the learning milestone.
- **Packages:** `ghcr.io/open-macaron/controller` is public and linked to `macaron`. Only `release.yml` publishes.
- **Security:** private vulnerability reporting, Dependabot alerts, secret scanning with push protection on all repos.

The `macaron-bot` account itself: 2FA on; the profile says it's a bot and links here; **auto-watch off**, so forks and org repos don't flood the notifications the poller reads; e-mail notifications off; SSH signing key registered for verified commits.

## 5. Onboarding an upstream repo (`deploy/scripts/onboard-repo.sh`, run by a maintainer)

```
 PR to macaron: config/projects/<p>/repos/repo-a.yaml   (project CODEOWNERS; platform team for budget/users)
                 includes `fork: <6 random chars>-repo-a` (onboard-repo.sh --suggest prints one)
        │ merge
        ▼
 maintainer runs onboard-repo.sh org-x/repo-a   (with GH_INTERACT: the bot owns its forks, so it can configure them)
   ├ check upstream is public                    ← DESIGN.md "Everything is public"
   ├ check contribution rules: DCO? CLA (sign once for macaron-bot)? interaction limits?
   ├ POST /repos/org-x/repo-a/forks              (owner macaron-bot, name = the `fork:` from config, default branch only)
   ├ PUT  /repos/macaron-bot/<fork>/actions/permissions {enabled:false}
   ├ disable wiki/issues/projects on the fork
   └ scaffold knowledge/repos/org-x/repo-a/overview.md  → PR to knowledge
        │
        ▼
 controller (after deploy.sh picks up config/): refuses work on a trusted repo whose fork is missing
```

## 6. Bootstrap checklist

1. Org: apply §4 settings, create teams `maintainers` and `bots`, and add `macaron-bot` to `bots`.
2. Create `macaron` and push these docs. Then create `runner`, `knowledge` and `.github`. Apply the rulesets.
3. Create the three tokens (§3), approve `GH_ORG` in the org, and store them in the controller's Secret with `provision-secrets.sh` (DEPLOYMENT.md §4).
4. Add the webhook on `open-macaron/runner` (event `workflow_run`, HMAC secret) once the controller has its public URL. Done 2026-10-15, moved to the OpenShift Route on 2026-10-21 (DEPLOYMENT.md §6, "Moving `PUBLIC_URL`").
5. Onboard one sandbox upstream repo (§5) for milestone 1.

> **No `evidence` repository** (decided 2026-10-16): run media are GitHub user-attachments, uploaded by the controller against the bot's fork of each repository (DESIGN.md, Evidence).
