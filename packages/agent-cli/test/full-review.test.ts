import { RunResult } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { fullReviewResult } from "../src/full-review.ts";

const answer = RunResult.parse({
  action: "reply",
  message: "Ran the unit tests at `abc1234`.\n\n![dialog](attachment:image-1)\n\n### Verdict\n✅ **Verified**: the dialog opens.",
  summary: "✅ **Verified**: the dialog opens.",
  replies: [],
  attachments: [{ id: "image-1", path: "media/image-1.png", kind: "image", caption: "dialog" }],
  learnings: [],
});
const verdict = { ruleId: "org-x/no-eval", verdict: "pass" as const, evidence: [], explanation: "No eval." };

describe("fullReviewResult", () => {
  it("publishes both as one review, the verify answer as its message", () => {
    expect(fullReviewResult(answer, [verdict], 1)).toEqual({
      action: "review",
      review: [verdict],
      message: answer.message,
      summary: "✅ **Verified**: the dialog opens. Checked 1 of 1 rule.",
      replies: [],
      attachments: answer.attachments,
      learnings: [],
    });
  });

  it("keeps the verify answer, saying the rule checks didn't complete", () => {
    const result = fullReviewResult(answer, undefined, 3);
    expect(result).toMatchObject({ action: "reply", attachments: answer.attachments, summary: "✅ **Verified**: the dialog opens. The rule checks didn't complete." });
    expect(result?.message).toBe(`${answer.message ?? ""}\n\n_The rule checks didn't complete: \`@macaron-bot review\` runs them again._`);
  });

  it("keeps the rule verdicts, saying the verification didn't complete", () => {
    expect(fullReviewResult(undefined, [verdict], 2)).toMatchObject({
      action: "review",
      review: [verdict],
      message: expect.stringMatching(/^⚠️ The verification didn't complete/),
      summary: "The verification didn't complete. Checked 1 of 2 rules.",
    });
  });

  it("turns a question from the verify session into the review's message", () => {
    const asked = RunResult.parse({ ...answer, action: "ask", message: "Which theme should I check?", attachments: [] });
    expect(fullReviewResult(asked, [verdict], 1)).toMatchObject({ action: "review", message: "Which theme should I check?" });
  });

  it("fails when neither completed, so the run can be retried", () => {
    expect(fullReviewResult(undefined, undefined, 1)).toBeUndefined();
  });

  it("parses as a result, every case", () => {
    for (const result of [fullReviewResult(answer, [verdict], 1), fullReviewResult(answer, undefined, 1), fullReviewResult(undefined, [verdict], 1)]) {
      expect(RunResult.safeParse(result).success).toBe(true);
    }
  });
});
