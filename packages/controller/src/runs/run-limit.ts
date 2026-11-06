import type { Mode, RepoConfig } from "@open-macaron/contracts";
import type { TokenUsage } from "../budget/run-keys.ts";

/**
 * A run's budget in USD: what its key may spend, and what the caps reserve for it. A review's
 * follows the rules it checks (`reviewCost`), at most `budgets.review`; other modes' are flat.
 */
export function runLimitUsd(config: Pick<RepoConfig, "budgets" | "reviewCost">, mode: Mode, context: { readonly review?: { readonly rules: readonly unknown[] } | undefined }): number {
  if (mode !== "review" || context.review === undefined) return config.budgets[mode];
  const { baseUsd, perRuleUsd } = config.reviewCost;
  return Math.min(config.budgets.review, baseUsd + perRuleUsd * context.review.rules.length);
}

/**
 * A run's token ceiling: the strictest one among the free models its key allows, or none. Bifrost
 * caps a key, not a model, and counts the run's tokens jointly: the smallest ceiling bounds the run,
 * so each model stays under its own. A mixed run's paid calls count too, a second limit behind the
 * USD budget. Paid runs keep the USD budget alone.
 */
export function runLimitTokens(models: readonly string[], runTokens: (model: string) => number | undefined): number | undefined {
  const ceilings = [...new Set(models)].map(runTokens).filter((tokens): tokens is number => tokens !== undefined);
  return ceilings.length === 0 ? undefined : Math.min(...ceilings);
}

/**
 * Why a run whose key reached its token cap stopped, for a failure the thread can act on; nothing
 * for a key under its cap, or without one.
 */
export function tokenBudgetExhausted(usage: TokenUsage | undefined): string | undefined {
  if (usage?.limit === undefined || usage.used < usage.limit) return undefined;
  return `its token budget was exhausted (${String(usage.used)} of ${String(usage.limit)} tokens)`;
}
