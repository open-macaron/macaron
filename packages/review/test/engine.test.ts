import { describe, expect, it } from "vitest";
import { annotateDiff, claudeReviewArgs, parseGitDiff, reviewSystemPrompt, reviewTaskPrompt, type ReviewSubject, structuredOutput, verdictsSchema } from "../src/index.ts";

const rule = (id: string) => ({ id, scope: "x", title: `Rule ${id}`, severity: "warning" as const, appliesTo: null, exclude: [], sources: [], body: "## Check\n…" });
const subject = (count: number): ReviewSubject => ({
  what: "pull request org-x/repo-a#7",
  title: "T",
  head: "a".repeat(40),
  diffCommand: `git diff ${"b".repeat(40)} HEAD -- <path>`,
  rules: Array.from({ length: count }, (_, index) => ({ rule: rule(`x/r${String(index)}`), files: ["src/a.ts"] })),
});

describe("the read-only review session", () => {
  it("only reads (dontAsk, a short tool list, git history), and answers in the verdicts' schema", () => {
    const args = claudeReviewArgs({ model: "anthropic/claude-haiku-5.5", systemPromptFile: "/tmp/p.md" });
    expect(args).toContain("dontAsk");
    expect(args).not.toContain("bypassPermissions");
    expect(args).not.toContain("--mcp-config");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Grep,Glob,Bash,Agent"]);
    expect(args.slice(args.indexOf("--allowedTools"))).toEqual(["--allowedTools", "Bash(git log *)", "Bash(git blame *)", "Bash(git show *)", "Bash(git diff *)"]);
    expect(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 3)).toEqual(["--output-format", "json", "--json-schema"]);
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
  it("asks for subagents only when there are many rules, and says how to read a diff too large to include", () => {
    expect(reviewSystemPrompt(subject(2))).not.toContain("subagent");
    expect(reviewSystemPrompt(subject(6))).toContain("subagent");
    expect(reviewSystemPrompt(subject(1))).toContain("You review pull request org-x/repo-a#7");
    expect(reviewTaskPrompt(subject(1), undefined)).toContain(`git diff ${"b".repeat(40)} HEAD -- <path>`);
  });

  it("includes who asked only when someone did", () => {
    expect(reviewTaskPrompt(subject(1), "diff")).not.toContain("asked");
    expect(reviewTaskPrompt({ ...subject(1), request: { author: "alice", url: "https://x", instruction: "review" } }, "diff")).toContain("@alice asked (https://x)");
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
