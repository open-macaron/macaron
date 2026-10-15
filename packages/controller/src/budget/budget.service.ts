import { Injectable, Logger } from "@nestjs/common";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { toMicros, type UsdMicros } from "../common/money.ts";
import { OpenRouterKeys, type ProvisionedKey } from "./openrouter-keys.ts";

/** Prefix of every key we mint; the sweeper only ever touches keys with this prefix. */
export const RUN_KEY_PREFIX = "macaron-run-";

/** Usage is reported asynchronously: we wait until two reads agree, at most this many reads. */
const SETTLE_MAX_READS = 8;
const SETTLE_READ_INTERVAL_MS = 2_500;

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

  /**
   * Ends a key's life: disable it first (spending stops now), wait for usage to settle,
   * record it, then delete the key. Returns the final cost.
   */
  async settle(hash: string, signal: AbortSignal): Promise<UsdMicros> {
    await this.keys.disable(hash);
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

  /** Best effort, for abort paths: never throws, the sweeper is the safety net. */
  async revoke(hash: string): Promise<void> {
    try {
      await this.keys.disable(hash);
      await this.keys.delete(hash);
    } catch (error: unknown) {
      this.logger.error(`revoking key ${hash.slice(0, 8)}… failed: ${describeError(error)}`);
    }
  }
}
