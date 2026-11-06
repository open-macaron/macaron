import { describe, expect, it } from "vitest";
import { runLimitTokens, runLimitUsd, tokenBudgetExhausted } from "../../src/runs/run-limit.ts";

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

describe("runLimitTokens", () => {
  const ceilings: ReadonlyMap<string, number> = new Map([
    ["free-a", 50_000_000],
    ["free-b", 30_000_000],
  ]);
  const runTokens = (model: string): number | undefined => ceilings.get(model);

  it("caps a run that allows a free model by the strictest ceiling it allows", () => {
    expect(runLimitTokens(["free-a", "free-a"], runTokens)).toBe(50_000_000);
    expect(runLimitTokens(["free-b", "free-a"], runTokens)).toBe(30_000_000);
    expect(runLimitTokens(["paid", "free-b"], runTokens)).toBe(30_000_000);
  });

  it("leaves a paid run to its USD budget", () => {
    expect(runLimitTokens(["paid", "paid"], runTokens)).toBeUndefined();
  });
});

describe("tokenBudgetExhausted", () => {
  it("names the budget and its size for the thread once the key reached its cap", () => {
    expect(tokenBudgetExhausted({ used: 50_000_123, limit: 50_000_000 })).toBe("its token budget was exhausted (50000123 of 50000000 tokens)");
    expect(tokenBudgetExhausted({ used: 50_000_000, limit: 50_000_000 })).toBe("its token budget was exhausted (50000000 of 50000000 tokens)");
  });

  it("leaves the conclusion alone for a key under its cap, or without one", () => {
    expect(tokenBudgetExhausted({ used: 49_999_999, limit: 50_000_000 })).toBeUndefined();
    expect(tokenBudgetExhausted(undefined)).toBeUndefined();
    // A paid run's key counts tokens too, with no cap to exhaust.
    expect(tokenBudgetExhausted({ used: 80_000_000, limit: undefined })).toBeUndefined();
  });
});
