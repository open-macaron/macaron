import { Injectable, Logger } from "@nestjs/common";
import { Clock } from "../common/clock.ts";
import { describeError, UpstreamError } from "../common/errors.ts";
import { toMicros, type UsdMicros } from "../common/money.ts";
import { OpenRouterKeys, type ProvisionedKey } from "./openrouter-keys.ts";

/** Prefix of every key we mint; the sweeper only ever touches keys with this prefix. */
export const RUN_KEY_PREFIX = "macaron-run-";

/**
 * OpenRouter reports a key's usage asynchronously (measured: ~25 s after the call). The final
 * read happens in a background job well after the key is disabled, and still waits for two
 * agreeing reads before trusting the number.
 */
const SETTLE_MAX_READS = 12;
const SETTLE_READ_INTERVAL_MS = 10_000;

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    private readonly keys: OpenRouterKeys,
    private readonly clock: Clock,
  ) {}

  /**
   * A key for one run: capped at `limitUsd`, and expiring by itself `ttlMinutes` from now
   * even if the controller never gets to settle it.
   */
  async mint(runId: string, limitUsd: number, ttlMinutes: number): Promise<ProvisionedKey> {
    const expiresAt = new Date(this.clock.now().getTime() + ttlMinutes * 60_000);
    return this.keys.create(`${RUN_KEY_PREFIX}${runId}`, limitUsd, expiresAt);
  }

  async usage(hash: string): Promise<UsdMicros> {
    return toMicros((await this.keys.status(hash)).usageUsd);
  }

  /** Spending stops now: the next request with the key is refused. Idempotent. */
  async freeze(hash: string): Promise<void> {
    await this.keys.disable(hash);
  }

  /**
   * The key's final cost, then deletes it. Call once the key is frozen and usage had time to
   * arrive (the settle-cost job runs ~90 s after the run ends).
   */
  async finalUsage(hash: string, signal: AbortSignal): Promise<UsdMicros> {
    let previous = await this.usage(hash);
    for (let read = 1; read < SETTLE_MAX_READS; read++) {
      await this.clock.sleep(SETTLE_READ_INTERVAL_MS, signal);
      const current = await this.usage(hash);
      if (current === previous) break;
      previous = current;
    }
    await this.keys.delete(hash);
    return previous;
  }

  /** Best effort, for cleanup paths: never throws (the sweeper is the safety net); a missing key is fine. */
  async revoke(hash: string): Promise<void> {
    try {
      await this.keys.disable(hash);
      await this.keys.delete(hash);
    } catch (error: unknown) {
      if (httpStatusOf(error) === 404) return;
      this.logger.error(`revoking key ${hash.slice(0, 8)}… failed: ${describeError(error)}`);
    }
  }
}

function httpStatusOf(error: unknown): number | undefined {
  return error instanceof UpstreamError ? error.status : undefined;
}
