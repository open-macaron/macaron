import { describe, expect, it } from "vitest";
import { runLimitUsd } from "../../src/runs/run-limit.ts";

const config = {
  budgets: { triage: 0.2, plan: 1, implement: 5, address_review: 2, reproduce: 3, verify: 3, retro: 0.5, review: 1 },
  reviewCost: { baseUsd: 0.1, perRuleUsd: 0.04 },
};
const review = (rules: number) => ({ review: { rules: Array.from({ length: rules }, (_, index) => index) } });

describe("runLimitUsd", () => {
  it("gives a review a base plus a share per rule, at most budgets.review", () => {
    expect(runLimitUsd(config, "review", review(3))).toBeCloseTo(0.22);
    expect(runLimitUsd(config, "review", review(18))).toBeCloseTo(0.82);
    expect(runLimitUsd(config, "review", review(40))).toBe(1);
  });

  it("keeps other modes' budgets flat", () => {
    expect(runLimitUsd(config, "implement", {})).toBe(5);
  });
});
