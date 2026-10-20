import type { Mode, RepoConfig } from "@open-macaron/contracts";

/**
 * A run's budget in USD: what its key may spend, and what the caps reserve for it. A review's
 * follows the rules it checks (`reviewCost`), at most `budgets.review`; other modes' are flat.
 */
export function runLimitUsd(config: Pick<RepoConfig, "budgets" | "reviewCost">, mode: Mode, context: { readonly review?: { readonly rules: readonly unknown[] } | undefined }): number {
  if (mode !== "review" || context.review === undefined) return config.budgets[mode];
  const { baseUsd, perRuleUsd } = config.reviewCost;
  return Math.min(config.budgets.review, baseUsd + perRuleUsd * context.review.rules.length);
}
