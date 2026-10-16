# @open-macaron/review

Check your changes against the [open-macaron/knowledge](https://github.com/open-macaron/knowledge) rules before you push, the way `@macaron-bot review` checks a pull request. It's the same engine:

- rules picked by the files you changed;
- one read-only agent session that judges them all;
- a violation kept only if it quotes a line you added.

Your local agent does the judging: Claude Code, on your own subscription. There's no account and no backend, and the rules are public.

```sh
npx @open-macaron/review --project podman-desktop-extensions
```

```
❌ violation  podman-desktop-extensions/svelte-runes  (error)
    Use Svelte 5 runes, not legacy reactivity
    packages/frontend/src/lib/monaco-editor/FileEditor.svelte:18  export let debugLabel: string = '';
    This uses Svelte 4 `export let` syntax instead of Svelte 5 runes. Use `let { debugLabel = '' } = $props();` instead.

⚠️ warning  podman-desktop-extensions/no-console-debug  (warning)
    No console.log or console.debug in shipped code
    packages/frontend/src/lib/monaco-editor/FileEditor.svelte:38  console.log('editor language', language);
    A `console.log()` call was added in shipped component code. Remove this debug statement before shipping.

➖ ignored  podman-desktop-extensions/ui-svelte-components  (warning)
    Use @podman-desktop/ui-svelte components for common controls
    The added lines contain state declarations and logic, not raw HTML control elements.

❌ 1 · ⚠️ 1 · ✅ 0 · ➖ 1 · rules from open-macaron/knowledge@1aaf8f4
```

Requires Node.js 24, git, and [Claude Code](https://code.claude.com) (`claude`, logged in).

## Commands

| Command | What |
|---|---|
| `macaron-review [review]` | Review the changes with your local agent |
| `macaron-review rules` | List the rules that apply to the changes, and those that don't (no agent; `--all` lists every rule of the project) |

## Options

| Option | |
|---|---|
| `--project P` | The project's rules, on top of the global ones (global → project → repository), e.g. `podman-desktop-extensions` |
| `--repo OWNER/NAME` | The repository's rules. Default: the `upstream` remote, else `origin` |
| `--base BRANCH` | Compare to `BRANCH`, from the merge base. Default: the remote's default branch |
| `--committed` | Only committed changes |
| `--uncommitted` | Only staged and unstaged changes |
| `--include-untracked` | Also files not added to git yet |
| `--agent` | One JSON object per line, for coding agents and scripts |
| `--harness claude` | The local agent that judges (only Claude Code for now) |
| `--model M` | The harness's model. Default: its own |
| `--show-prompts` | Print the prompts instead of running the review |
| `--dir PATH` | The git worktree to review. Default: the current directory |
| `--knowledge-url URL` | The rules' read API. Default: `https://open-macaron.github.io/knowledge/v1` |

By default the review covers the net changes from the merge base with the default branch to your working tree, committed or not.

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | No violation of an `error` rule. Warnings don't fail |
| 1 | At least one `error` rule is violated |
| 2 | The review couldn't run: not a git worktree, the rules are unreachable, or the agent failed |

## For coding agents: `--agent`

Add this to your repository's `AGENTS.md` (or `CLAUDE.md`):

> Before pushing, run `npx @open-macaron/review --agent --project podman-desktop-extensions`. Fix the `violation` results (and `warning` results when reasonable), then run it once more. Don't loop more than twice.

Each line is one event:

```jsonc
{"type":"context","repo":"podman-desktop/extension-podman-quadlet","project":"podman-desktop-extensions","base":"main","mergeBase":"26bafc8…","knowledgeCommit":"1aaf8f4…","rules":3,"skipped":0,"files":2}
{"type":"rule","id":"podman-desktop-extensions/svelte-runes","severity":"error","result":"violation","evidence":[{"file":"src/A.svelte","line":18,"quote":"export let debugLabel: string = '';"}],"explanation":"…"}
{"type":"rule","id":"podman-desktop-extensions/no-console-debug","severity":"warning","result":"valid","evidence":[],"explanation":"…"}
{"type":"complete","status":"done","counts":{"violation":1,"warning":0,"valid":1,"ignored":1},"problems":[],"model":null}
```

`result` is one of:

- `violation`: an `error` rule, with evidence;
- `warning`: a `warning` rule, with evidence;
- `valid`;
- `ignored`: not applicable, or a violation whose quote isn't on an added line.

When nothing changed or no rule applies, the review ends with `{"type":"complete","status":"review_skipped","reason":"…"}`, without calling the agent.

`macaron-review rules --agent` emits the `context` event, then one `rule` event per applicable rule (`files`: the files it matched) and one `skipped` event per rule left out.

## Examples

A pre-push hook (`.git/hooks/pre-push`):

```sh
#!/bin/sh
exec npx -y @open-macaron/review --committed --project podman-desktop-extensions
```

Look at what the agent will be asked:

```sh
npx @open-macaron/review --show-prompts --project podman-desktop-extensions | less
```

## How it relates to the bot

`@macaron-bot review` runs this engine on a GitHub Actions runner. It uses the pull request's base, the rules the controller selected, and a budget-capped key.

The controller then checks the evidence again against GitHub's diff, and posts the table as a pull request review. A local review and the bot's review get the same prompts, the same read-only session and the same verification. Their verdicts can still differ by model.

The judging session can only read:

- tools: `Read`, `Grep` and `Glob`, plus `Bash` restricted to `git log`, `git blame`, `git show` and `git diff`;
- permission mode `dontAsk`;
- no MCP servers.
