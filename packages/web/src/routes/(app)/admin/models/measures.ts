import type { ModelStats } from "#lib/admin/forms.js";
import { formatMillions, formatUsd } from "#lib/format.js";

export type ModelRow = ModelStats["models"][number];
export type Measure = "cost" | "tokens";

interface MeasureSpec {
  /** What the bars measure, in their tooltip. */
  readonly label: string;
  /** A bar's length; null for no bar rather than a zero. */
  readonly value: (model: ModelRow) => number | null;
  readonly format: (value: number) => string;
}

/** What the models page's bars can measure. */
export const measures: Readonly<Record<Measure, MeasureSpec>> = {
  cost: { label: "Avg. cost", value: (model) => model.avgCostUsd, format: formatUsd },
  // Null when none of the model's runs had a token count.
  tokens: { label: "Avg. tokens", value: (model) => model.avgTokens, format: formatMillions },
};
