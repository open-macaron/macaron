import { readFileSync } from "node:fs";
import { z } from "zod";
import { zPricingPatch } from "../generated/bifrost/zod.gen.ts";

/** A model's prices, by Bifrost's price-patch field names (`input_cost_per_token`…), in USD. */
export type PricePatch = Readonly<Record<string, number>>;

/** A sanity bound on a free model's token ceiling, not a spend decision. */
export const MAX_RUN_TOKENS = 1_000_000_000;

/** What the pinned list says about a model: its prices, and the token ceiling of a free one. */
interface PinnedModel {
  readonly patch: PricePatch;
  readonly maxRunTokens: number | undefined;
}

/** A free model on purpose: priced 0 for both directions, with the ceiling its runs get. */
const FreeMark = z.object({
  free: z.literal(true),
  input_cost_per_token: z.literal(0),
  output_cost_per_token: z.literal(0),
  max_run_tokens: z.int().positive().max(MAX_RUN_TOKENS),
});

/**
 * The pinned list prices (deploy/bifrost/pricing.json, also Bifrost's catalog), as the price
 * overrides each endpoint's Bifrost provider needs: Bifrost prices a provider created at runtime
 * from overrides only, and charges $0 for a model without one. A model is billable when priced, or
 * marked free on purpose with the token ceiling its runs get: a zero price alone is a forgotten one.
 */
export class PriceList {
  private constructor(private readonly models: ReadonlyMap<string, PinnedModel>) {}

  /** Every field of each model that Bifrost's price patch knows; the rest (capabilities, limits) is left out. */
  static fromFile(path: string): PriceList {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const entries = z.record(z.string(), z.record(z.string(), z.unknown())).parse(raw);
    const fields = new Set<string>(zPricingPatch.keyof().options);
    const models = new Map<string, PinnedModel>();
    for (const [model, entry] of Object.entries(entries)) {
      const patch: Record<string, number> = {};
      for (const [field, value] of Object.entries(entry)) {
        if (fields.has(field) && typeof value === "number" && Number.isFinite(value) && value >= 0) patch[field] = value;
      }
      models.set(model, { patch, maxRunTokens: freeMark(model, entry) });
    }
    return new PriceList(models);
  }

  /** `free` maps each free model of `patches` to its token ceiling. */
  static of(patches: ReadonlyMap<string, PricePatch>, free: ReadonlyMap<string, number> = new Map()): PriceList {
    const models = new Map<string, PinnedModel>();
    for (const [model, patch] of patches) models.set(model, { patch, maxRunTokens: free.get(model) });
    return new PriceList(models);
  }

  /** The model's prices, if a budget can limit it: priced, or free on purpose (its prices are zero). */
  patch(model: string): PricePatch | undefined {
    const pinned = this.models.get(model);
    if (pinned === undefined) return undefined;
    return isPriced(pinned.patch) || pinned.maxRunTokens !== undefined ? pinned.patch : undefined;
  }

  /** A free model's ceiling on one run's total tokens. */
  runTokens(model: string): number | undefined {
    return this.models.get(model)?.maxRunTokens;
  }

  isFree(model: string): boolean {
    return this.runTokens(model) !== undefined;
  }

  /** The models a run can use, by name: priced, or free and capped by tokens. */
  billable(): string[] {
    return [...this.models.keys()].filter((model) => this.patch(model) !== undefined).sort();
  }

  /** The free models, by name. */
  free(): string[] {
    return [...this.models.keys()].filter((model) => this.isFree(model)).sort();
  }

  /** The models among `models` a run can't use: neither priced nor marked free. */
  unbillable(models: readonly string[]): string[] {
    return [...new Set(models)].filter((model) => this.patch(model) === undefined);
  }
}

function isPriced(patch: PricePatch): boolean {
  return (patch["input_cost_per_token"] ?? 0) > 0 && (patch["output_cost_per_token"] ?? 0) > 0;
}

/** A free model's token ceiling; a mark on a priced model, or one without a ceiling, is a mistake. */
function freeMark(model: string, entry: Readonly<Record<string, unknown>>): number | undefined {
  if (!Object.hasOwn(entry, "free")) return undefined;
  const mark = FreeMark.safeParse(entry);
  if (!mark.success) throw new Error(`${model} has an invalid free mark (prices 0, max_run_tokens 1…${String(MAX_RUN_TOKENS)}): ${z.prettifyError(mark.error)}`);
  return mark.data.max_run_tokens;
}
