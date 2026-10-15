import { Injectable, Logger } from "@nestjs/common";
import { Clock } from "../common/clock.ts";
import { describeError, UpstreamError } from "../common/errors.ts";
import { toMicros, type UsdMicros } from "../common/money.ts";
import { OpenRouterKeys, type ProvisionedKey } from "./openrouter-keys.ts";

/** Prefix of every key we mint; the sweeper only ever touches keys with this prefix. */
export const RUN_KEY_PREFIX = "macaron-run-";

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

  /** What the key spent since `since` (a little before the run started), from OpenRouter analytics. */
  async usage(hash: string, since: Date): Promise<UsdMicros> {
    return toMicros(await this.keys.spentSince(hash, since));
  }

  /** Spending stops now: the next request with the key is refused. Idempotent. */
  async freeze(hash: string): Promise<void> {
    await this.keys.disable(hash);
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
