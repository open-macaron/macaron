import type { UsdMicros } from "../common/money.ts";

/** After this long, whatever OpenRouter reports is final (a key that never spent stays at 0). */
export const SETTLE_MAX_WAIT_MS = 15 * 60_000;
/** Interval between two usage readings of an unsettled key. */
export const SETTLE_RECHECK_MS = 60_000;

export interface SettlementInput {
  /** Did the run ever receive its key? A key that never left the controller spent nothing. */
  readonly redeemed: boolean;
  /** Usage OpenRouter reports for the key right now. */
  readonly observedMicros: UsdMicros;
  /** The reading from the previous attempt, a recheck interval ago. */
  readonly previousMicros: UsdMicros | undefined;
  /** Time since the run finished (its key was frozen then). */
  readonly sinceFinishMs: number;
}

export type SettlementDecision =
  | { readonly kind: "settle"; readonly costMicros: UsdMicros }
  | { readonly kind: "recheck"; readonly observedMicros: UsdMicros };

/**
 * OpenRouter reports a key's usage asynchronously, and two early readings of 0 prove nothing
 * (the first e2e run was recorded at $0 that way). A redeemed key is settled only on a non-zero
 * reading that didn't move since the previous one, or after SETTLE_MAX_WAIT_MS.
 */
export function decideSettlement(input: SettlementInput): SettlementDecision {
  if (!input.redeemed) return { kind: "settle", costMicros: 0 };
  if (input.sinceFinishMs >= SETTLE_MAX_WAIT_MS) return { kind: "settle", costMicros: input.observedMicros };
  if (input.observedMicros > 0 && input.observedMicros === input.previousMicros) {
    return { kind: "settle", costMicros: input.observedMicros };
  }
  return { kind: "recheck", observedMicros: input.observedMicros };
}
