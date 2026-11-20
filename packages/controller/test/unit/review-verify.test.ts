import { CommitSha, type PublishedRule, type ReviewContext, type RuleVerdict } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { diffFileFromPatch as toDiffFile, type PullDiff, verifyReview } from "@open-macaron/review";
import { MAX_REVIEW_BODY, renderReview, withReviewCost } from "../../src/review/render.ts";

const HEAD = CommitSha.parse("a".repeat(40));
const BASE = CommitSha.parse("b".repeat(40));

function rule(id: string, severity: PublishedRule["severity"] = "error"): PublishedRule {
  return { id, scope: "sandbox", title: `title of ${id}`, severity, appliesTo: ["src/**"], exclude: [], sources: [], body: "## Check\n…" };
}

const review: ReviewContext = {
  pull: 2,
  baseSha: BASE,
  headSha: HEAD,
  rules: [
    { rule: rule("sandbox/json"), files: ["src/extension.ts"] },
    { rule: rule("sandbox/style", "warning"), files: ["src/extension.ts"] },
    { rule: rule("sandbox/quiet"), files: ["src/extension.ts"] },
  ],
  skipped: [{ id: "sandbox/svelte", title: "title of sandbox/svelte", severity: "error", reason: "no_matching_file" }],
  knowledgeCommit: CommitSha.parse("c".repeat(40)),
};

const diff: PullDiff = {
  baseSha: BASE,
  headSha: HEAD,
  files: [
    toDiffFile("src/extension.ts", undefined, "@@ -10,2 +10,4 @@\n context();\n+  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));\n+  x();\n done();"),
    toDiffFile("README.md", undefined, "@@ -1 +1,2 @@\n # x\n+  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));"),
  ],
};

const verdict = (overrides: Partial<RuleVerdict>): RuleVerdict => ({ ruleId: "sandbox/json", verdict: "pass", evidence: [], explanation: "", ...overrides });
const quote = { file: "src/extension.ts", line: 11, quote: "JSON.parse(await readFile(join(root, 'package.json')" };

describe("verifyReview", () => {
  it("keeps a violation whose quote is on an added line, as ❌ for errors and ⚠️ for warnings", () => {
    const { results, problems } = verifyReview(
      review,
      [verdict({ verdict: "violation", evidence: [quote], explanation: "reads it at runtime" }), verdict({ ruleId: "sandbox/style", verdict: "violation", evidence: [quote] }), verdict({ ruleId: "sandbox/quiet" })],
      diff,
    );
    expect(problems).toEqual([]);
    expect(results.map((result) => [result.id, result.outcome])).toEqual([
      ["sandbox/json", "violation"],
      ["sandbox/style", "warning"],
      ["sandbox/quiet", "valid"],
      ["sandbox/svelte", "ignored"],
    ]);
    expect(results[0]?.evidence).toEqual([quote]);
  });

  it.each([
    ["a wrong line number", { ...quote, line: 10 }],
    ["a context line", { ...quote, line: 10, quote: "context();" }],
    ["text that isn't on the line", { ...quote, quote: "fs.readFileSync('package.json')" }],
    ["a file the rule doesn't apply to", { ...quote, file: "README.md", line: 2 }],
    ["a quote too short to mean anything", { ...quote, quote: "pkg" }],
  ])("ignores a violation backed only by %s", (_case, evidence) => {
    const { results } = verifyReview(review, [verdict({ verdict: "violation", evidence: [evidence] })], diff);
    expect(results[0]).toMatchObject({ outcome: "ignored", reason: "violation claimed without verifiable evidence", evidence: [] });
  });

  it("accepts a re-indented quote", () => {
    const { results } = verifyReview(review, [verdict({ verdict: "violation", evidence: [{ ...quote, quote: "JSON.parse(await   readFile(join(root,  'package.json')" }] })], diff);
    expect(results[0]?.outcome).toBe("violation");
  });

  it("ignores a violation found only in code the change moves, from another file or re-indented", () => {
    const line = "  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));";
    const moved: PullDiff = { ...diff, files: [toDiffFile("src/extension.ts", undefined, `@@ -10,2 +10,3 @@\n context();\n+${line}\n done();`), toDiffFile("src/old.ts", undefined, `@@ -1,2 +1 @@\n keep();\n-${line.trim()}`)] };
    const { results } = verifyReview(review, [verdict({ verdict: "violation", evidence: [quote] })], moved);
    expect(results[0]).toMatchObject({ outcome: "ignored", reason: "violation found only in code the change moves", evidence: [] });
  });

  it("keeps a violation on a copy the change adds beyond the lines it removes", () => {
    const line = "  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));";
    const copied: PullDiff = {
      ...diff,
      files: [toDiffFile("src/extension.ts", undefined, `@@ -10,3 +10,4 @@\n context();\n-${line}\n+${line}\n+${line}\n done();`)],
    };
    const { results } = verifyReview(review, [verdict({ verdict: "violation", evidence: [quote] })], copied);
    expect(results[0]?.outcome).toBe("violation");
  });

  it("refuses a review that leaves a rule without a verdict, and never shows it as valid", () => {
    const { results, problems } = verifyReview(review, [verdict({ ruleId: "sandbox/style" })], diff);
    expect(problems).toEqual(["the review left rules unchecked: sandbox/json, sandbox/quiet"]);
    expect(results[0]).toMatchObject({ outcome: "ignored", reason: "not checked" });
  });

  it("reports verdicts for unknown rules and repeated verdicts as problems", () => {
    const all = [verdict({}), verdict({ ruleId: "sandbox/style" }), verdict({ ruleId: "sandbox/quiet" })];
    const { problems } = verifyReview(review, [...all, verdict({}), verdict({ ruleId: "global/invented" })], diff);
    expect(problems).toEqual(["two verdicts for sandbox/json", "verdict for a rule that wasn't asked: global/invented"]);
  });
});

describe("renderReview", () => {
  const { results } = verifyReview(
    review,
    [verdict({ verdict: "violation", evidence: [quote], explanation: "Reads it at runtime, ping @someone" }), verdict({ ruleId: "sandbox/quiet" })],
    diff,
  );
  const meta = { repo: "axel7083/foobar-tmp-demo", headSha: HEAD, knowledgeCommit: review.knowledgeCommit, loop: 2, runner: "ubuntu-24.04", model: "claude-sonnet-5-5", ghRunId: 1, runUrl: "https://example.test/run/1", costMicros: null };

  it("stays short: one sentence, then the checks collapsed and grouped, what needs action open", () => {
    const { body } = renderReview(results, meta);
    const [first] = body.split("\n");
    expect(first).toBe("**macaron-bot review** of `aaaaaaa`: 1 violation of the knowledge rules, see the inline comments.");
    expect(body).toContain("<summary><b>Rule checks</b> | ❌ 1 · ✅ 1 · ➖ 2</summary>");
    expect(body).toContain("<details open>\n<summary>❌ Violations (1)</summary>");
    expect(body).toContain("<details>\n<summary>✅ Passed (1)</summary>");
    expect(body).toContain("<details>\n<summary>➖ Ignored (2)</summary>");
    expect(body.indexOf("Violations")).toBeLessThan(body.indexOf("Passed"));
    expect(body).toContain(`[\`src/extension.ts:11\`](https://github.com/axel7083/foobar-tmp-demo/blob/${HEAD}/src/extension.ts#L11)`);
    expect(body).toContain("| title of sandbox/svelte<br>`sandbox/svelte` | ➖ | no matching file changed |");
    expect(body).toContain("[open-macaron/knowledge@ccccccc]");
    expect(body).toContain("Cost: ⏳<!-- /macaron:review-cost --> · loop 2 · runner `ubuntu-24.04` · model `claude-sonnet-5-5` · [run 1](https://example.test/run/1)</sub>");
  });

  it("says plainly when everything passes, or nothing could be checked", () => {
    const passing = verifyReview(review, [verdict({}), verdict({ ruleId: "sandbox/style" }), verdict({ ruleId: "sandbox/quiet" })], diff).results;
    expect(renderReview(passing, meta).body.split("\n")[0]).toBe("**macaron-bot review** of `aaaaaaa`: all 3 rules that apply pass.");
    expect(renderReview([], meta).body.split("\n")[0]).toBe("**macaron-bot review** of `aaaaaaa`: no rule could be checked on this change.");
  });

  it("defuses mentions in the reviewer's explanations", () => {
    const { body, comments } = renderReview(results, meta);
    expect(body).toContain("ping `@someone`");
    expect(body).not.toContain("@someone ");
    expect(comments).toEqual([{ path: "src/extension.ts", line: 11, side: "RIGHT", body: "❌ violation **`sandbox/json`**: title of sandbox/json\n\nReads it at runtime, ping `@someone`" }]);
  });

  it("replaces the cost once settled", () => {
    const { body } = renderReview(results, meta);
    expect(withReviewCost(body, 31_000)).toContain("Cost: $0.03");
    expect(withReviewCost("no segment", 1)).toBeUndefined();
  });

  describe("full review", () => {
    const answer = "Ran the tests at `aaaaaaa`.\n\n### Verdict\n✅ **Verified**: the dialog opens.";

    it("puts the verify answer first, then the rule checks, and names the rules' model", () => {
      const { body, comments } = renderReview(results, { ...meta, ruleModel: "claude-haiku-5-5" }, answer);
      expect(body.startsWith(`${answer}\n\n---\n\n**macaron-bot review** of \`aaaaaaa\`: 1 violation`)).toBe(true);
      expect(body).toContain("model `claude-sonnet-5-5` · rules `claude-haiku-5-5` ·");
      expect(withReviewCost(body, 31_000)).toContain("Cost: $0.03");
      expect(comments).toHaveLength(1);
    });

    it("keeps only what needs attention when the review would be over GitHub's limit", () => {
      // One character over the limit with every row; the separator is 7 characters.
      const long = "x".repeat(MAX_REVIEW_BODY - renderReview(results, meta).body.length - 6);
      const { body, comments } = renderReview(results, meta, long);
      expect(body.length).toBeLessThanOrEqual(MAX_REVIEW_BODY);
      expect(body.startsWith(long)).toBe(true);
      expect(body).toContain("<details open>\n<summary>❌ Violations (1)</summary>");
      expect(body).toContain("✅ Passed (1): left out, this review would be over GitHub's size limit.");
      expect(body).toContain("Cost: ⏳");
      expect(comments).toHaveLength(1);
    });

    it("cuts the answer as a last resort", () => {
      const { body } = renderReview(results, meta, "y".repeat(MAX_REVIEW_BODY + 10));
      expect(body.length).toBeLessThanOrEqual(MAX_REVIEW_BODY);
      expect(body).toContain("… _Cut here: this review would be over GitHub's size limit._\n\n---\n\n**macaron-bot review**");
    });
  });
});
