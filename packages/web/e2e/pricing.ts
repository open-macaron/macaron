import { readFileSync } from "node:fs";
import { z } from "zod";

const Prices = z.record(
  z.string(),
  z.object({ input_cost_per_token: z.number().optional(), output_cost_per_token: z.number().optional(), free: z.literal(true).optional() }),
);

const entries = Object.entries(Prices.parse(JSON.parse(readFileSync(new URL("../../../deploy/bifrost/pricing.json", import.meta.url), "utf8"))));

/** The models the gateway bills for, or serves free and caps by tokens (deploy/bifrost/pricing.json), as the controller's PriceList reads them. */
export const PRICED: readonly string[] = entries
  .filter(([, price]) => price.free === true || ((price.input_cost_per_token ?? 0) > 0 && (price.output_cost_per_token ?? 0) > 0))
  .map(([model]) => model)
  .sort();

/** The models the gateway serves at no charge: a run on one is capped by tokens. */
export const FREE: readonly string[] = entries
  .filter(([, price]) => price.free === true)
  .map(([model]) => model)
  .sort();

/** A model as the key page shows it: free ones carry their token cap. */
export function labelled(model: string): string {
  return FREE.includes(model) ? `${model} (free, capped by tokens)` : model;
}
