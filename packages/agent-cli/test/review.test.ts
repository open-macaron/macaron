import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CommitSha, RepoSlug, RunContext, RunResult, Ticket } from "@open-macaron/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/commands.ts";
import { claudeArgs, structuredOutput } from "../src/harness.ts";
import { type Inputs, paths } from "../src/inputs.ts";
import { reviewSystemPrompt, reviewTaskPrompt } from "../src/prompts.ts";
import { annotateDiff } from "../src/review-diff.ts";

const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", args, { cwd });

describe("claudeArgs", () => {
  const base = { model: "anthropic/claude-haiku-5.5", systemPromptFile: "/tmp/p.md" };

  it("keeps write sessions as they were", () => {
    expect(claudeArgs({ ...base, access: "write" })).toEqual([
      "--print", "--model", "anthropic/claude-haiku-5.5", "--append-system-prompt-file", "/tmp/p.md", "--no-session-persistence",
      "--output-format", "text", "--permission-mode", "bypassPermissions",
    ]);
  });

  it("limits read-only sessions to reading tools and git history, refusing anything else, with a schema-bound answer", () => {
    const args = claudeArgs({ ...base, access: "read-only", outputSchema: { type: "object" } });
    expect(args).toContain("dontAsk");
    expect(args).not.toContain("bypassPermissions");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Grep,Glob,Bash,Agent"]);
    expect(args.slice(args.indexOf("--allowedTools"))).toEqual(["--allowedTools", "Bash(git log *)", "Bash(git blame *)", "Bash(git show *)", "Bash(git diff *)"]);
    expect(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 4)).toEqual(["--output-format", "json", "--json-schema", '{"type":"object"}']);
  });
});

describe("structuredOutput", () => {
  it("reads structured_output, else JSON final text, else nothing", () => {
    expect(structuredOutput(JSON.stringify({ structured_output: { verdicts: [] }, result: "done" }))).toEqual({ verdicts: [] });
    expect(structuredOutput(JSON.stringify({ result: '{"verdicts":[]}' }))).toEqual({ verdicts: [] });
    expect(structuredOutput(JSON.stringify({ result: "I could not finish." }))).toBeUndefined();
    expect(structuredOutput("not json")).toBeUndefined();
  });
});

describe("annotateDiff", () => {
  it("numbers lines in the pull request's version, as the controller verifies them", () => {
    const raw = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,2 +10,3 @@\n context();\n-old();\n+eval(input);\n+done();\n";
    expect(annotateDiff(raw)).toBe("### src/a.ts\n@@\n     10 | context();\n-       | old();\n+    11 | eval(input);\n+    12 | done();");
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
    await Promise.all([mkdir(p.work, { recursive: true }), mkdir(p.state, { recursive: true }), mkdir(p.media, { recursive: true }), mkdir(join(p.tools, "node_modules", ".bin"), { recursive: true })]);
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
    await writeFile(p.bootstrapFile, JSON.stringify({ harness: "claude", model: "anthropic/claude-haiku-5.5" }));
    await writeFile(p.keyFile, "sk-or-v1-test");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A stand-in for Claude Code: records its arguments and stdin, prints `answer` as its JSON result. */
  async function fakeClaude(answer: unknown): Promise<string> {
    const p = paths(inputs);
    const log = join(root, "claude.log");
    const script = `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\ncat >> '${log}'\nprintf '%s' '${JSON.stringify(answer).replaceAll("'", "'\\''")}'\n`;
    const bin = join(p.tools, "node_modules", ".bin", "claude");
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
    expect(seen).toContain("+     2 | eval(input);");
    expect(seen).toContain("### `org-x/no-eval` (error): No eval");
  });

  it("fails without valid verdicts, so the run can be retried", async () => {
    await fakeClaude({ result: "I ran out of budget." });
    expect(await run(inputs)).toBe(1);
  });
});

describe("review prompts", () => {
  it("asks for subagents only when there are many rules", () => {
    const rule = { id: "x/r", scope: "x", title: "R", severity: "warning", appliesTo: null, exclude: [], sources: [], body: "## Check" };
    const context = (count: number) =>
      RunContext.parse({
        mode: "review",
        repo: "org-x/repo-a",
        number: 7,
        kind: "pull",
        title: "T",
        baseSha: "a".repeat(40),
        branch: "macaron/7-t",
        trigger: { kind: "mention", author: "alice", url: "https://github.com/org-x/repo-a/pull/7", instruction: "review" },
        thread: [],
        reviewComments: [],
        priorLoops: [],
        commands: {},
        attachments: { maxFiles: 1, maxFileBytes: 1, maxTotalBytes: 1 },
        review: { pull: 7, baseSha: "b".repeat(40), headSha: "a".repeat(40), rules: Array.from({ length: count }, (_, i) => ({ rule: { ...rule, id: `x/r${String(i)}` }, files: ["f"] })), skipped: [], knowledgeCommit: null },
      });
    expect(reviewSystemPrompt(context(2))).not.toContain("subagent");
    expect(reviewSystemPrompt(context(6))).toContain("subagent");
    expect(reviewTaskPrompt(context(1), undefined)).toContain(`git diff ${"b".repeat(40)}...HEAD -- <path>`);
  });
});
