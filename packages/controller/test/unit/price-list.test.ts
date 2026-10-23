import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PriceList } from "../../src/budget/price-list.ts";

const PINNED = fileURLToPath(new URL("../../../../deploy/bifrost/pricing.json", import.meta.url));

describe("PriceList", () => {
  it("reads the pinned prices as Bifrost price patches", () => {
    const prices = PriceList.fromFile(PINNED);
    const sonnet = prices.patch("claude-sonnet-5-5");
    expect(sonnet?.["input_cost_per_token"]).toBeGreaterThan(0);
    expect(sonnet?.["output_cost_per_token"]).toBeGreaterThan(0);
    expect(sonnet?.["cache_read_input_token_cost"]).toBeGreaterThan(0);
    // Capabilities and limits aren't prices.
    expect(Object.keys(sonnet ?? {})).not.toContain("max_tokens");
  });

  it("calls unpriced a model it doesn't list, or lists without both prices", () => {
    const prices = PriceList.of(new Map([["half", { input_cost_per_token: 1e-6 }], ["full", { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 }]]));
    expect(prices.unpriced(["full", "half", "missing", "full"])).toEqual(["half", "missing"]);
  });
});
