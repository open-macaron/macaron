import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PriceList } from "../../src/budget/price-list.ts";

const PINNED = fileURLToPath(new URL("../../../../deploy/bifrost/pricing.json", import.meta.url));

function listOf(entries: Record<string, unknown>): PriceList {
  const path = join(mkdtempSync(join(tmpdir(), "price-list-")), "pricing.json");
  writeFileSync(path, JSON.stringify(entries));
  return PriceList.fromFile(path);
}

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

  it("reads the free models and the token ceiling of each", () => {
    const prices = PriceList.fromFile(PINNED);
    expect(prices.free()).toEqual(["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"]);
    expect(prices.patch("rits/deepseek-ai/DeepSeek-V4.1-Flash-1017")).toEqual({ input_cost_per_token: 0, output_cost_per_token: 0 });
    expect(prices.runTokens("rits/deepseek-ai/DeepSeek-V4.1-Flash-1017")).toBe(50_000_000);
    expect(prices.isFree("rits/deepseek-ai/DeepSeek-V4.1-Flash-1017")).toBe(true);
    expect(prices.runTokens("claude-sonnet-5-5")).toBeUndefined();
    expect(prices.billable()).toContain("rits/deepseek-ai/DeepSeek-V4.1-Flash-1017");
  });

  it("calls unbillable a model it doesn't list, or lists without both prices", () => {
    const prices = PriceList.of(new Map([["half", { input_cost_per_token: 1e-6 }], ["full", { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 }]]));
    expect(prices.unbillable(["full", "half", "missing", "full"])).toEqual(["half", "missing"]);
  });

  it("bills a zero-priced model only when it is marked free", () => {
    const zero = { input_cost_per_token: 0, output_cost_per_token: 0 };
    const prices = PriceList.of(
      new Map([
        ["marked", zero],
        ["forgotten", zero],
      ]),
      new Map([["marked", 1_000]]),
    );
    expect(prices.unbillable(["marked", "forgotten"])).toEqual(["forgotten"]);
    expect(prices.isFree("marked")).toBe(true);
    expect(prices.runTokens("marked")).toBe(1_000);
    expect(prices.isFree("forgotten")).toBe(false);
  });

  it("refuses a malformed free mark, saying what is wrong", () => {
    expect(() => listOf({ m: { free: true, input_cost_per_token: 1e-6, output_cost_per_token: 0, max_run_tokens: 1_000 } })).toThrow(/m has an invalid free mark.*input_cost_per_token/s);
    expect(() => listOf({ m: { free: true, max_run_tokens: 1_000 } })).toThrow(/invalid free mark.*output_cost_per_token/s);
    expect(() => listOf({ m: { free: true, input_cost_per_token: 0, output_cost_per_token: 0 } })).toThrow(/invalid free mark.*max_run_tokens/s);
    expect(() => listOf({ m: { free: false, input_cost_per_token: 0, output_cost_per_token: 0, max_run_tokens: 1_000 } })).toThrow(/invalid free mark.*free/s);
  });
});
