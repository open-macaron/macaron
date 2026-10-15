import { CommitSha, type PublishedRule, type ReviewContext, type RuleVerdict } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { toDiffFile, type PullDiff } from "../../src/review/pull-diff.ts";
import { renderReview, withReviewCost } from "../../src/review/render.ts";
import { verifyReview } from "../../src/review/verify.ts";

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

  it("shows rules left without a verdict as not checked, never as valid", () => {
    const { results } = verifyReview(review, [], diff);
    expect(results.slice(0, 3).every((result) => result.outcome === "ignored" && result.reason === "not checked")).toBe(true);
  });

  it("reports verdicts for unknown rules and repeated verdicts as problems", () => {
    const { problems } = verifyReview(review, [verdict({}), verdict({}), verdict({ ruleId: "global/invented" })], diff);
    expect(problems).toEqual(["two verdicts for sandbox/json", "verdict for a rule that wasn't asked: global/invented"]);
  });
});

describe("renderReview", () => {
  const { results } = verifyReview(
    review,
    [verdict({ verdict: "violation", evidence: [quote], explanation: "Reads it at runtime, ping @someone" }), verdict({ ruleId: "sandbox/quiet" })],
    diff,
  );
  const meta = { repo: "axel7083/foobar-tmp-demo", headSha: HEAD, knowledgeCommit: review.knowledgeCommit, runUrl: "https://example.test/run/1", costMicros: null };

  it("summarises, lists every rule most severe first, and links evidence at the reviewed commit", () => {
    const { body } = renderReview(results, meta);
    expect(body).toContain("**macaron-bot review** of `aaaaaaa` against [open-macaron/knowledge@ccccccc]");
    expect(body).toContain("❌ 1 · ⚠️ 0 · ✅ 1 · ➖ 2");
    expect(body.indexOf("sandbox/json")).toBeLessThan(body.indexOf("sandbox/quiet"));
    expect(body).toContain(`[\`src/extension.ts:11\`](https://github.com/axel7083/foobar-tmp-demo/blob/${HEAD}/src/extension.ts#L11)`);
    expect(body).toContain("| ➖ ignored | no matching file changed |");
    expect(body).toContain("Cost: ⏳");
  });

  it("defuses mentions in the reviewer's explanations", () => {
    const { body, comments } = renderReview(results, meta);
    expect(body).toContain("ping `@someone`");
    expect(comments).toEqual([{ path: "src/extension.ts", line: 11, side: "RIGHT", body: "❌ violation **`sandbox/json`**: title of sandbox/json\n\nReads it at runtime, ping `@someone`" }]);
  });

  it("replaces the cost once settled", () => {
    const { body } = renderReview(results, meta);
    expect(withReviewCost(body, 31_000)).toContain("Cost: $0.03");
    expect(withReviewCost("no segment", 1)).toBeUndefined();
  });
});
