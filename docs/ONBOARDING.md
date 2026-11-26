# Onboarding your repository

This guide is for maintainers who want macaron-bot to work on their repository. It covers what to check first, how to get an account, the one pull request that adds a repository, and the first run. The other docs explain how the bot works inside; you don't need them to onboard.

## 1. What you get

macaron-bot is an AI contributor you trigger with a mention: `@macaron-bot plan`, `implement`, `review`, `reproduce`, `verify` (the full list is in the [README](../README.md#what-the-bot-can-do)). It works like an outside contributor:

- **It never gets write access to your repository.** It pushes to its own fork and opens pull requests from there, which you review and merge like anyone else's.
- **Everything is public:** its comments, its pull requests, and the logs of its runs in [open-macaron/runner](https://github.com/open-macaron/runner).
- **Each run is paid by whoever asked for it**, with their own LLM key, under a monthly cap they set. Your repository also gets caps per thread and per month, whoever pays.

## 2. Before you start

- **The repository must be public.** Run logs are public, and they include what the agent read. The bot refuses to fork a private repository.
- **Contribution rules:**
  - DCO: set `contribution: { dco: true }` in the configuration (§4) and every commit of the bot is signed off.
  - A CLA: a maintainer signs it once for the `macaron-bot` account, before its first pull request.
  - Interaction limits or a first-time contributor policy that would block an outside account: allow `macaron-bot`, or its comments and pull requests won't show up.

## 3. Get an account

Only people with an account of the macaron web app can trigger the bot. Anyone else who mentions it gets a 👎 reaction and nothing more: no reply, no cost.

1. **Ask for an invitation:** [open an issue](https://github.com/open-macaron/macaron/issues/new) on open-macaron/macaron, or ask the platform team. Say which commands you need: an administrator grants each account its capabilities (triage, plan, implement, reproduce, verify, review, remember). The invitation includes the app's address.
2. **Sign in with GitHub.** At your first visit, the app walks you through the bot, the commands you may use, and your key.
3. **Save your LLM key** on one of the endpoints the administrators approved. The key is write-only: it's sealed, never shown again, and handed to the gateway for one run at a time. You can set a monthly cap in dollars. Runs on free models are bounded by a monthly token cap instead, 500M tokens by default. You can also pick which models your runs use. Details: [USER-KEYS.md](USER-KEYS.md).

Without a saved key, the bot refuses your requests, with a link to the key page.

## 4. Add your repository

Adding a repository is one pull request to [open-macaron/config](https://github.com/open-macaron/config), opened from a fork: nobody pushes branches there. Its [README](https://github.com/open-macaron/config#readme) explains approvals in detail.

**Your organisation already has a folder** (`orgs/<org>/`): add an entry under `repos` in `orgs/<org>/org.yaml`. The owners listed in that folder's `OWNERS.yaml` approve it on GitHub, and the `merge` workflow merges it. You don't need write access to the config repository.

```yaml
repos:
  my-repo:
    knowledge: my-project        # which rules apply: projects/<knowledge>/ in open-macaron/knowledge (default: the org's login)
    environment:                 # how the runner sets up your project (default: shared "generic")
      source: shared
      name: generic
      params: {}
    commands:                    # what the agent runs to check its work
      build: pnpm build
      test: pnpm test
      lint: pnpm lint
    contribution:
      dco: true
```

Name the upstream repository only, never a fork: the bot creates its own fork and keeps track of it.

**Your organisation has no folder yet:** open a pull request that adds `orgs/<org>/org.yaml` and `orgs/<org>/OWNERS.yaml`. The platform team reviews and merges it by hand. The org file needs your account's id, which stays the same when a login is renamed (`gh api users/<login> --jq .id`, for organisations too). `OWNERS.yaml` lists who approves later changes in your folder, matched by id:

```yaml
owners:
  - login: your-login
    id: 12345678
```

**Settings reserved for the platform team.** A change to one of these is merged by hand, whatever the owners approve: `id`, `fallback` (which trusts every repository the org doesn't list), `bots`, `concurrency`, `budgets`, `caps`, `reviewCost`, `runsOn` and `platforms`. These decide whose comments count and what the bot may spend or run on. To change one, say what you need in the pull request.

**Environments.** The `generic` shared environment covers common Node, Python and Go projects. A project that needs more (an application to start, a VM, Windows) uses another shared environment from [open-macaron/runner](https://github.com/open-macaron/runner/tree/main/environments), or an `upstream` one: a composite action in your own repository under `.github/macaron/`, read from the base commit. See [SCALING.md §1](SCALING.md#1-environments-shared-own-or-upstream-provided).

**Check before you push**, with the same validation the controller runs: see "Checking locally" in the config README. The file formats are JSON Schemas (`config-*.schema.json` in [packages/contracts/schemas](../packages/contracts/schemas)), and [SCALING.md §2](SCALING.md#2-configuration-a-hierarchy-not-one-trustyaml) explains how the settings are inherited.

## 5. After the merge

- The configuration is live within seconds, without a deploy.
- The bot forks your repository, turns off Actions on the fork, and comments on your config pull request with the fork's link. If it can't fork, the comment says why.
- The web app's **Organisations** page shows your repository as Ready once its fork exists.
- Until then, requests on the repository wait (the bot's fork is still being created).

If your organisation has a `fallback`, its other repositories need no pull request: the bot forks each one the first time someone asks it for something there.

## 6. Your first run

Try `@macaron-bot plan` on an issue: it posts a plan and changes nothing. Then:

- the bot reacts with 👀 within a minute, then 👍 or 😕;
- it answers with one comment, with its run, runner and cost in a small footer that is updated until the cost settles;
- a failure always gets a comment saying why.

Next, try `implement` on an issue, which opens a draft pull request from the bot's fork, or `review` on a pull request. On its own pull requests, the bot addresses reviews from people with an account without a mention. `@macaron-bot stop` stops a run, and `@macaron-bot retry` runs a failed one again.

## 7. Teach it your project (optional)

The bot follows the rules and lessons of [open-macaron/knowledge](https://github.com/open-macaron/knowledge) when it writes code, and checks the rules one by one when it reviews. Add yours in a pull request there: `projects/<project>/` for every repository of a project, or `repos/<owner>/<repo>/` for one. A `repos/<owner>/<repo>/overview.md` with your layout and your build and test quirks is given to the agent on every run. Like the config repository, each folder's `OWNERS.yaml` decides who approves.

You can run the same review locally before you push, with your own agent: `npx @open-macaron/review --project <project>` ([packages/review](../packages/review/README.md)).

## 8. Leaving

Remove the repository's entry from the config repository, and the bot stops working there. Its fork stays: nothing deletes one.
