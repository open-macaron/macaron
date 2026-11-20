import { type Mode, Mode as Modes } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { ruleModel, rulesForMode } from "../../src/ingest/context-builder.ts";

describe("rulesForMode", () => {
  it.each<[Mode]>([["implement"], ["address_review"]])("gives %s the rules: it can change code", (mode) => {
    expect(rulesForMode(mode, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("gives no other mode the rules", () => {
    const others = Modes.options.filter((mode) => mode !== "implement" && mode !== "address_review");
    expect(others.flatMap((mode) => rulesForMode(mode, ["a"]))).toEqual([]);
  });

  it("stays within what the contract accepts", () => {
    expect(rulesForMode("implement", Array.from({ length: 201 }, () => "a"))).toHaveLength(200);
  });
});

describe("ruleModel", () => {
  it("checks a full review's rules on the review model, when the repository sets one", () => {
    expect(ruleModel("full_review", { models: { review: "cheap" } })).toBe("cheap");
    expect(ruleModel("full_review", { models: {} })).toBeUndefined();
  });

  it("leaves a review on its run's model, which is already the review model", () => {
    expect(ruleModel("review", { models: { review: "cheap" } })).toBeUndefined();
  });
});
