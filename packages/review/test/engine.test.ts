import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  annotateDiff,
  annotatedFiles,
  claudeReviewArgs,
  claudeTriageArgs,
  judge,
  mergeVerdicts,
  missingRules,
  parseGitDiff,
  partitionRules,
  reviewSystemPrompt,
  reviewTaskPrompt,
  type ReviewSubject,
  structuredOutput,
  triageSchema,
  verdictsSchema,
} from "../src/index.ts";

const rule = (id: string) => ({ id, scope: "x", title: `Rule ${id}`, severity: "warning" as const, appliesTo: null, exclude: [], sources: [], body: "## Check\n…" });
const subject = (count: number, files = (_index: number) => ["src/a.ts"]): ReviewSubject => ({
  what: "pull request org-x/repo-a#7",
  title: "T",
  head: "a".repeat(40),
  diffCommand: `git diff ${"b".repeat(40)} HEAD -- <path>`,
  rules: Array.from({ length: count }, (_, index) => ({ rule: rule(`x/r${String(index)}`), files: files(index) })),
});
const pass = (ruleId: string) => ({ ruleId, verdict: "pass" as const, evidence: [], explanation: "" });

describe("the read-only review sessions", () => {
  it("only read (dontAsk, a short tool list without subagents, git history), and answer in the verdicts' schema", () => {
    const args = claudeReviewArgs({ model: "anthropic/claude-haiku-5.5", systemPromptFile: "/tmp/p.md" });
    expect(args).toContain("dontAsk");
    expect(args).not.toContain("bypassPermissions");
    expect(args).not.toContain("--mcp-config");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Grep,Glob,Bash"]);
    expect(args.slice(args.indexOf("--allowedTools"))).toEqual(["--allowedTools", "Bash(git log *)", "Bash(git blame *)", "Bash(git show *)", "Bash(git diff *)"]);
    expect(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 3)).toEqual(["--output-format", "json", "--json-schema"]);
  });

  it("gives triage no tools at all, and its own schema", () => {
    const args = claudeTriageArgs({ systemPromptFile: "/tmp/p.md" });
    expect(args).toContain("dontAsk");
    expect(args.slice(args.indexOf("--tools"))).toEqual(["--tools", ""]);
    expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(triageSchema()));
    expect(triageSchema()).not.toHaveProperty("$schema");
  });

  it("uses the harness's default model unless one is given", () => {
    expect(claudeReviewArgs({ systemPromptFile: "/tmp/p.md" })).not.toContain("--model");
  });

  it("gives Claude Code a draft-7 schema without $schema (its validator doesn't know 2020-12)", () => {
    const schema = verdictsSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(JSON.stringify(schema)).toContain('"verdicts"');
  });

  it("reads structured_output, else a JSON final text, else nothing", () => {
    expect(structuredOutput(JSON.stringify({ structured_output: { verdicts: [] }, result: "done" }))).toEqual({ verdicts: [] });
    expect(structuredOutput(JSON.stringify({ result: '{"verdicts":[]}' }))).toEqual({ verdicts: [] });
    expect(structuredOutput(JSON.stringify({ result: "I could not finish." }))).toBeUndefined();
    expect(structuredOutput("not json")).toBeUndefined();
  });
});

describe("prompts", () => {
  it("never asks for subagents, and says how to read a diff too large to include", () => {
    expect(reviewSystemPrompt(subject(20))).not.toContain("subagent");
    expect(reviewSystemPrompt(subject(1))).toContain("You review pull request org-x/repo-a#7");
    expect(reviewTaskPrompt(subject(1), undefined)).toContain(`git diff ${"b".repeat(40)} HEAD -- <path>`);
  });

  it("includes who asked only when someone did", () => {
    expect(reviewTaskPrompt(subject(1), "diff")).not.toContain("asked");
    expect(reviewTaskPrompt({ ...subject(1), request: { author: "alice", url: "https://x", instruction: "review" } }, "diff")).toContain("@alice asked (https://x)");
  });
});

describe("review phases", () => {
  it("checks up to 8 rules in one session, more in two, rules on the same files together", () => {
    expect(partitionRules([])).toEqual([]);
    expect(partitionRules(subject(8).rules)).toHaveLength(1);
    const groups = partitionRules(subject(18, (index) => [index % 2 === 0 ? "src/even.ts" : "src/odd.ts"]).rules);
    expect(groups.map((group) => group.length)).toEqual([9, 9]);
    expect(groups.map((group) => new Set(group.flatMap(({ files }) => files)).size)).toEqual([1, 1]);
  });

  it("merges one verdict per rule in the rules' order, the first source winning, and lists the missing ones", () => {
    const { rules } = subject(3);
    const merged = mergeVerdicts(rules, [[{ ...pass("x/r2"), verdict: "not_applicable" }], [pass("x/r0"), pass("x/r2"), pass("x/invented")]]);
    expect(merged.map((verdict) => [verdict.ruleId, verdict.verdict])).toEqual([
      ["x/r0", "pass"],
      ["x/r2", "not_applicable"],
    ]);
    expect(missingRules(rules, merged)).toEqual(["x/r1"]);
  });

  describe("judge", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "macaron-judge-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const command = join(import.meta.dirname, "fixtures", "fake-claude.ts");
    const run = async (subject: ReviewSubject, annotatedDiff: string | undefined, fake: { notApplicable?: string[]; dropped?: string[]; alwaysDropped?: boolean } = {}) => {
      await writeFile(join(dir, "fake-claude.json"), JSON.stringify(fake));
      return judge({ command, cwd: dir, subject, annotatedDiff });
    };
    const calls = async () => (await readFile(join(dir, "calls.log"), "utf8")).trim().split("\n").sort();
    const diff = "### src/a.ts\n@@\n+     1 | a();\n\n### src/b.ts\n@@\n+     1 | b();";

    it("triages many rules, then checks the rest in two sessions, each on the diff of its files", async () => {
      const many = subject(12, (index) => [index < 6 ? "src/a.ts" : "src/b.ts"]);
      const judgement = await run(many, diff, { notApplicable: ["x/r0", "x/r1"] });
      expect(judgement.problems).toEqual([]);
      expect(judgement.verdicts?.map((verdict) => verdict.verdict)).toEqual([...Array<string>(2).fill("not_applicable"), ...Array<string>(10).fill("pass")]);
      expect(judgement.sessions.map((session) => [session.phase, session.rules])).toEqual([
        ["triage", 12],
        ["check", 5],
        ["check", 5],
      ]);
      expect(await calls()).toEqual([
        "check x/r2,x/r3,x/r4,x/r5,x/r6 diff:src/a.ts,src/b.ts",
        "check x/r7,x/r8,x/r9,x/r10,x/r11 diff:src/b.ts",
        "triage x/r0,x/r1,x/r2,x/r3,x/r4,x/r5,x/r6,x/r7,x/r8,x/r9,x/r10,x/r11 diff:src/a.ts,src/b.ts",
      ]);
    });

    it("skips triage for a few rules, or when the diff is too large to include", async () => {
      expect((await run(subject(3), diff)).sessions.map((session) => session.phase)).toEqual(["check"]);
      expect((await run(subject(12), undefined)).sessions.map((session) => session.phase)).toEqual(["check", "check"]);
    });

    it("checks the rules a session left without a verdict once more", async () => {
      const judgement = await run(subject(3), diff, { dropped: ["x/r1"] });
      expect(judgement.verdicts?.map((verdict) => verdict.ruleId)).toEqual(["x/r0", "x/r1", "x/r2"]);
      expect(await calls()).toEqual(["check x/r0,x/r1,x/r2 diff:src/a.ts", "check x/r1 diff:src/a.ts"]);
    });

    it("fails, rather than returning a partial review, when rules are still missing", async () => {
      const judgement = await run(subject(3), diff, { dropped: ["x/r1"], alwaysDropped: true });
      expect(judgement.verdicts).toBeUndefined();
      expect(judgement.problems).toEqual(["the review left rules unchecked: x/r1"]);
    });
  });
});

describe("git diffs", () => {
  const raw = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,2 +10,3 @@\n context();\n-old();\n+eval(input);\n+done();\n";

  it("numbers lines in the new version, as the verification reads them", () => {
    expect(annotateDiff(raw)).toBe("### src/a.ts\n@@\n     10 | context();\n-       | old();\n+    11 | eval(input);\n+    12 | done();");
    expect([...(parseGitDiff(raw).files[0]?.added ?? [])]).toEqual([
      [11, "eval(input);"],
      [12, "done();"],
    ]);
  });

  it("keeps only the sections of the files asked for", () => {
    const annotated = "### src/a.ts\n@@\n+     1 | a();\n\n### src/b.ts\n@@\n+     1 | b();\n\n### src/c.ts\n@@\n+     1 | c();";
    expect(annotatedFiles(annotated, ["src/c.ts", "src/a.ts"])).toBe("### src/a.ts\n@@\n+     1 | a();\n\n### src/c.ts\n@@\n+     1 | c();");
    expect(annotatedFiles(annotated, [])).toBe("");
  });

  it("keeps deleted files (nothing added) and renames' previous path", () => {
    const deleted = "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n";
    const renamed = "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1,2 @@\n x\n+y\n";
    const files = parseGitDiff(`${deleted}${renamed}`).files;
    expect(files.map((file) => [file.path, file.previousPath])).toEqual([
      ["gone.ts", undefined],
      ["new.ts", "old.ts"],
    ]);
  });
});
