import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { CommitSha, RepoSlug, RunContext, RunResult, Ticket } from "@open-macaron/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeReviewArgs } from "@open-macaron/review";
import { environmentExtras, run } from "../src/commands.ts";
import { claudeArgs, claudeBinary } from "../src/harness.ts";
import { type Inputs, paths } from "../src/inputs.ts";

const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", args, { cwd });

describe("claudeArgs", () => {
  it("runs write sessions with every tool and no prompts", () => {
    expect(claudeArgs({ model: "anthropic/claude-sonnet-5.5", systemPromptFile: "/tmp/p.md" })).toEqual([
      "--print", "--model", "anthropic/claude-sonnet-5.5", "--append-system-prompt-file", "/tmp/p.md", "--no-session-persistence",
      "--output-format", "text", "--permission-mode", "bypassPermissions",
    ]);
  });
});

describe("environment MCP servers", () => {
  const base = { model: "anthropic/claude-sonnet-5.5", systemPromptFile: "/tmp/p.md", mcpConfigFile: "/tmp/env/mcp.json" };

  it("gives write sessions only the environment's servers", () => {
    const args = claudeArgs(base);
    expect(args.slice(args.indexOf("--mcp-config"))).toEqual(["--mcp-config", "/tmp/env/mcp.json", "--strict-mcp-config"]);
  });

  it("never gives them to review sessions", () => {
    expect(claudeReviewArgs({ model: base.model, systemPromptFile: base.systemPromptFile })).not.toContain("--mcp-config");
  });

  it("reads the environment's instructions and MCP config when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "macaron-env-"));
    try {
      expect(await environmentExtras(dir)).toEqual({ notes: undefined, mcpConfigFile: undefined });
      await writeFile(join(dir, "AGENTS.md"), "## Environment: Podman Desktop is running\n");
      await writeFile(join(dir, "mcp.json"), "{}");
      expect(await environmentExtras(dir)).toEqual({ notes: "## Environment: Podman Desktop is running", mcpConfigFile: join(dir, "mcp.json") });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("review run", () => {
  let root: string;
  let inputs: Inputs;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "macaron-review-"));
    inputs = {
      MACARON_CONTROLLER_URL: "https://macaron.example.org",
      MACARON_TICKET: Ticket.parse(`t_${"a".repeat(43)}`),
      MACARON_REPO: RepoSlug.parse("org-x/repo-a"),
      MACARON_FORK: RepoSlug.parse("macaron-bot/abc123-repo-a"),
      MACARON_BRANCH: "macaron/12-review",
      MACARON_BASE_SHA: CommitSha.parse("0".repeat(40)),
      MACARON_HARNESS: "claude",
      RUNNER_TEMP: join(root, "tmp"),
      GITHUB_WORKSPACE: join(root, "ws"),
    };
    const p = paths(inputs);
    await Promise.all([mkdir(p.work, { recursive: true }), mkdir(p.state, { recursive: true }), mkdir(p.media, { recursive: true }), mkdir(dirname(claudeBinary(p.tools)), { recursive: true })]);
    // The upstream: a base commit, then the pull request's head. `origin` is the work tree itself.
    await git(p.work, "init", "--quiet");
    await git(p.work, "config", "user.email", "t@t");
    await git(p.work, "config", "user.name", "t");
    await writeFile(join(p.work, "a.ts"), "context();\n");
    await git(p.work, "add", "--all");
    await git(p.work, "commit", "--quiet", "-m", "base");
    const baseSha = (await git(p.work, "rev-parse", "HEAD")).stdout.trim();
    await writeFile(join(p.work, "a.ts"), "context();\neval(input);\n");
    await git(p.work, "commit", "--quiet", "-am", "head");
    const headSha = (await git(p.work, "rev-parse", "HEAD")).stdout.trim();
    await git(p.work, "remote", "add", "origin", p.work);

    const rule = { id: "org-x/no-eval", scope: "org-x", title: "No eval", severity: "error", appliesTo: ["**/*.ts"], exclude: [], sources: [], body: "## Check\nDoes it call eval?" };
    const context = RunContext.parse({
      mode: "review",
      repo: "org-x/repo-a",
      number: 7,
      kind: "pull",
      title: "Add eval",
      baseSha: headSha,
      branch: "macaron/7-review",
      trigger: { kind: "mention", author: "alice", url: "https://github.com/org-x/repo-a/pull/7#issuecomment-1", instruction: "review" },
      thread: [],
      reviewComments: [],
      priorLoops: [],
      commands: {},
      attachments: { maxFiles: 10, maxFileBytes: 1_000_000, maxTotalBytes: 5_000_000 },
      review: { pull: 7, baseSha, headSha, rules: [{ rule, files: ["a.ts"] }], skipped: [], knowledgeCommit: null },
    });
    await writeFile(p.contextFile, JSON.stringify(context));
    await writeFile(
      p.bootstrapFile,
      JSON.stringify({ harness: "claude", model: "claude-sonnet-5-5", baseUrl: "https://llm.example.test/anthropic", fastModel: "claude-haiku-4-5" }),
    );
    await writeFile(p.keyFile, "sk-bf-test");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A stand-in for Claude Code: records its arguments and stdin, prints `answer` as its JSON result. */
  async function fakeClaude(answer: unknown): Promise<string> {
    const p = paths(inputs);
    const log = join(root, "claude.log");
    const script = `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nprintf 'env %s %s %s\\n' "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" "$ANTHROPIC_DEFAULT_HAIKU_MODEL" >> '${log}'\ncat >> '${log}'\nprintf '%s' '${JSON.stringify(answer).replaceAll("'", "'\\''")}'\n`;
    const bin = claudeBinary(p.tools);
    await writeFile(bin, script);
    await chmod(bin, 0o755);
    return log;
  }

  it("runs a read-only session on the annotated diff and turns its verdicts into result.json", async () => {
    const verdict = { ruleId: "org-x/no-eval", verdict: "violation", evidence: [{ file: "a.ts", line: 2, quote: "eval(input);" }], explanation: "eval on input" };
    const log = await fakeClaude({ structured_output: { verdicts: [verdict] }, num_turns: 1 });

    expect(await run(inputs)).toBe(0);
    const result = RunResult.parse(JSON.parse(await readFile(paths(inputs).resultFile, "utf8")));
    expect(result).toMatchObject({ action: "review", review: [verdict], summary: "Checked 1 of 1 rule." });
    const seen = await readFile(log, "utf8");
    expect(seen).toContain("dontAsk");
    expect(seen).toContain("env https://llm.example.test/anthropic sk-bf-test claude-haiku-4-5");
    expect(seen).toContain("+     2 | eval(input);");
    expect(seen).toContain("### `org-x/no-eval` (error): No eval");
  });

  it("fails without valid verdicts, so the run can be retried", async () => {
    await fakeClaude({ result: "I ran out of budget." });
    expect(await run(inputs)).toBe(1);
  });
});
