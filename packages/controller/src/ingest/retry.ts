import type { RunStatus } from "../runs/runs.repository.ts";

interface Loop {
  readonly status: RunStatus;
  readonly createdAt: Date;
}

interface Refused {
  readonly createdAt: Date;
}

/** What `@macaron-bot retry` runs again. */
export type RetryTarget<L, R> = { readonly kind: "loop"; readonly run: L } | { readonly kind: "refused"; readonly event: R } | { readonly kind: "none" };

/**
 * The newest of the two wins: a request refused after the last loop (a platform not enabled yet,
 * no account) is replayed once its cause is fixed; otherwise the last loop, unless it succeeded.
 */
export function retryTarget<L extends Loop, R extends Refused>(lastLoop: L | undefined, lastRefused: R | undefined): RetryTarget<L, R> {
  if (lastRefused !== undefined && (lastLoop === undefined || lastRefused.createdAt > lastLoop.createdAt)) return { kind: "refused", event: lastRefused };
  if (lastLoop !== undefined && lastLoop.status !== "completed") return { kind: "loop", run: lastLoop };
  return { kind: "none" };
}
