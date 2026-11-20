import { CommitSha } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { withRuleModel } from "../../src/runs/run-launcher.ts";
import { runContext } from "../support/fixtures.ts";

const review = { pull: 3, baseSha: CommitSha.parse("b".repeat(40)), headSha: CommitSha.parse("c".repeat(40)), rules: [], skipped: [], knowledgeCommit: null };
const context = runContext({ mode: "full_review", kind: "pull", review });

describe("withRuleModel", () => {
  it("names a full review's rule model when the payer's review model isn't the run's", () => {
    expect(withRuleModel(context, "full_review", { model: "deepseek", fastModel: "deepseek", reviewModel: "sonnet" }).review?.model).toBe("sonnet");
  });

  it("leaves the context alone when both are the same model, or for another mode", () => {
    expect(withRuleModel(context, "full_review", { model: "deepseek", fastModel: "deepseek", reviewModel: "deepseek" })).toBe(context);
    const reviewContext = runContext({ mode: "review", kind: "pull", review });
    expect(withRuleModel(reviewContext, "review", { model: "sonnet", fastModel: "haiku", reviewModel: "sonnet" })).toBe(reviewContext);
  });
});
