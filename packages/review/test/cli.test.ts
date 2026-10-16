import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CommitSha, type KnowledgeSlice, type PublishedRule } from "@open-macaron/contracts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";
import { localScope } from "../src/scope.ts";

const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", args, { cwd });
const KNOWLEDGE = "https://knowledge.example.test/v1";
const COMMIT = CommitSha.parse("c".repeat(40));

const rule = (id: string, severity: PublishedRule["severity"], appliesTo: string[]): PublishedRule => ({
  id,
  scope: id.split("/")[0] ?? "global",
  title: `Rule ${id}`,
  severity,
  appliesTo,
  exclude: [],
  sources: [],
  body: "## Check\n…",
});
const slice = (scope: string, rules: PublishedRule[]): KnowledgeSlice => ({ version: 1, commit: COMMIT, scope, overview: null, rules, lessons: [] });

const server = setupServer(
  http.get(`${KNOWLEDGE}/global.json`, () => HttpResponse.json(slice("global", [rule("global/no-console-debug", "warning", ["**/*.ts"])]))),
  http.get(`${KNOWLEDGE}/projects/sandbox.json`, () => HttpResponse.json(slice("sandbox", [rule("sandbox/no-eval", "error", ["**/*.ts"]), rule("sandbox/svelte", "error", ["**/*.svelte"])]))),
  http.get(`${KNOWLEDGE}/repos/*`, () => new HttpResponse(null, { status: 404 })),
);
beforeAll(() => {
  server.listen({ onUnhandledFrame: "bypass" });
});
afterAll(() => {
  server.close();
});

let repo: string;

/** main has a.ts; the branch adds b.ts (committed) and changes a.ts in the working tree; c.ts is untracked. */
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "macaron-review-cli-"));
  await git(repo, "init", "--quiet", "--initial-branch=main");
  await git(repo, "config", "user.email", "t@t");
  await git(repo, "config", "user.name", "t");
  await git(repo, "commit", "--quiet", "--allow-empty", "-m", "root");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
  await git(repo, "add", "a.ts");
  await git(repo, "commit", "--quiet", "-m", "base");
  await git(repo, "switch", "--quiet", "-c", "feature");
  await writeFile(join(repo, "b.ts"), "eval(input);\n");
  await git(repo, "add", "b.ts");
  await git(repo, "commit", "--quiet", "-m", "feature");
  await writeFile(join(repo, "a.ts"), "export const a = 2;\nconsole.log(a);\n");
  await writeFile(join(repo, "c.ts"), "export const c = 3;\n");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(repo, { recursive: true, force: true });
});

describe("localScope", () => {
  const paths = async (mode: "all" | "committed" | "uncommitted", includeUntracked = false) =>
    (await localScope({ dir: repo, mode, includeUntracked })).files.map((file) => file.path).sort();

  it("reviews net changes from the merge base with the default branch, like CodeRabbit's default", async () => {
    expect(await paths("all")).toEqual(["a.ts", "b.ts"]);
  });

  it("can restrict to committed or uncommitted changes, and add untracked files", async () => {
    expect(await paths("committed")).toEqual(["b.ts"]);
    expect(await paths("uncommitted")).toEqual(["a.ts"]);
    expect(await paths("all", true)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("numbers added lines in the working tree's version", async () => {
    const scope = await localScope({ dir: repo, mode: "all", includeUntracked: false });
    expect([...(scope.files.find((file) => file.path === "a.ts")?.added ?? [])]).toEqual([
      [1, "export const a = 2;"],
      [2, "console.log(a);"],
    ]);
    expect(scope.base).toBe("main");
  });
});

describe("macaron-review", () => {
  let out: string;
  beforeEach(() => {
    out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
  });

  /** A stand-in for Claude Code that answers `answer` as its structured output. */
  async function fakeClaude(answer: unknown): Promise<string> {
    const bin = join(repo, "..", `fake-claude-${String(Date.now())}`);
    await writeFile(bin, `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${JSON.stringify({ structured_output: answer }).replaceAll("'", "'\\''")}'\n`);
    await chmod(bin, 0o755);
    return bin;
  }
  const common = ["--dir", "", "--project", "sandbox", "--knowledge-url", KNOWLEDGE];
  const args = (...extra: string[]) => [...common.map((value) => (value === "" ? repo : value)), ...extra];

  it("lists the rules that apply to the changes, and those that don't", async () => {
    expect(await main(["rules", ...args()])).toBe(0);
    expect(out).toContain("global/no-console-debug");
    expect(out).toContain("sandbox/no-eval");
    expect(out).toContain("Not applicable to these changes: sandbox/svelte");
  });

  it("reviews with the local agent, verifies the evidence, and fails on a violated error rule", async () => {
    const claude = await fakeClaude({
      verdicts: [
        { ruleId: "sandbox/no-eval", verdict: "violation", evidence: [{ file: "b.ts", line: 1, quote: "eval(input);" }], explanation: "eval on input" },
        { ruleId: "global/no-console-debug", verdict: "pass", evidence: [], explanation: "no console" },
      ],
    });
    expect(await main(args("--agent"), { claude })).toBe(1);
    const events = out.trim().split("\n").map((line): unknown => JSON.parse(line));
    expect(events[0]).toMatchObject({ type: "context", project: "sandbox", base: "main", knowledgeCommit: COMMIT, rules: 2, skipped: 1, files: 2 });
    expect(events).toContainEqual(expect.objectContaining({ type: "rule", id: "sandbox/no-eval", result: "violation" }));
    expect(events.at(-1)).toMatchObject({ type: "complete", status: "done", counts: { violation: 1, warning: 0, valid: 1, ignored: 1 } });
  });

  it("drops a violation whose quote isn't on an added line (exit 0, shown as ignored)", async () => {
    const claude = await fakeClaude({
      verdicts: [{ ruleId: "sandbox/no-eval", verdict: "violation", evidence: [{ file: "a.ts", line: 1, quote: "eval(input);" }], explanation: "" }],
    });
    expect(await main(args(), { claude })).toBe(0);
    expect(out).toContain("➖ ignored  sandbox/no-eval");
    expect(out).toContain("violation claimed without verifiable evidence");
  });

  it("skips the review when nothing applies, and can show the prompts instead of running", async () => {
    await git(repo, "stash", "--quiet");
    await git(repo, "reset", "--quiet", "--hard", "main");
    expect(await main(args("--agent"))).toBe(0);
    expect(out).toContain('"status":"review_skipped"');

    out = "";
    await writeFile(join(repo, "a.ts"), "eval(x);\n");
    expect(await main(args("--show-prompts"))).toBe(0);
    expect(out).toContain("You review the local changes of this repository (compared to main)");
    expect(out).toContain("+     1 | eval(x);");
  });

  it("refuses contradictory flags", async () => {
    await expect(main(args("--committed", "--uncommitted"))).rejects.toThrow(/can't be combined/);
  });
});
