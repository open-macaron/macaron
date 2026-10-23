import { readFileSync } from "node:fs";
import { z } from "zod";
import { zPricingPatch } from "../generated/bifrost/zod.gen.ts";

/** A model's prices, by Bifrost's price-patch field names (`input_cost_per_token`…), in USD. */
export type PricePatch = Readonly<Record<string, number>>;

/**
 * The pinned list prices (deploy/bifrost/pricing.json, also Bifrost's catalog), as the price
 * overrides each endpoint's Bifrost provider needs: Bifrost prices a provider created at runtime
 * from overrides only, and charges $0 for a model without one.
 */
export class PriceList {
  private constructor(private readonly patches: ReadonlyMap<string, PricePatch>) {}

  /** Every field of each model that Bifrost's price patch knows; the rest (capabilities, limits) is left out. */
  static fromFile(path: string): PriceList {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const models = z.record(z.string(), z.record(z.string(), z.unknown())).parse(raw);
    const fields = new Set<string>(zPricingPatch.keyof().options);
    const patches = new Map<string, PricePatch>();
    for (const [model, entry] of Object.entries(models)) {
      const prices: Record<string, number> = {};
      for (const [field, value] of Object.entries(entry)) {
        if (fields.has(field) && typeof value === "number" && Number.isFinite(value) && value >= 0) prices[field] = value;
      }
      patches.set(model, prices);
    }
    return new PriceList(patches);
  }

  static of(patches: ReadonlyMap<string, PricePatch>): PriceList {
    return new PriceList(patches);
  }

  /** The model's prices, if both input and output are priced: a budget can limit it. */
  patch(model: string): PricePatch | undefined {
    const patch = this.patches.get(model);
    return patch !== undefined && (patch["input_cost_per_token"] ?? 0) > 0 && (patch["output_cost_per_token"] ?? 0) > 0 ? patch : undefined;
  }

  unpriced(models: readonly string[]): string[] {
    return [...new Set(models)].filter((model) => this.patch(model) === undefined);
  }
}
