import { Injectable, Logger } from "@nestjs/common";
import { Clock } from "../common/clock.ts";
import { describeError, UpstreamError } from "../common/errors.ts";
import { toMicros, type UsdMicros } from "../common/money.ts";
import type { KeyStatus, LlmBackend } from "./run-keys.ts";
import { RunKeysRegistry } from "./run-keys.registry.ts";

/** Prefix of every key we mint; the sweeper only ever touches keys with this prefix. */
export const RUN_KEY_PREFIX = "macaron-run-";

/** A run's key as the runs table records it: which backend, and the backend's id for it. */
export interface RunKeyRef {
  readonly backend: LlmBackend;
  readonly hash: string;
}

export interface MintedKey extends RunKeyRef {
  /** The bearer key, held until the run's ticket is redeemed. */
  readonly key: string;
}

export interface SweepableKey extends KeyStatus {
  readonly backend: LlmBackend;
}

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    private readonly keys: RunKeysRegistry,
    private readonly clock: Clock,
  ) {}

  /**
   * A key for one run, on the active backend: capped at `limitUsd`, usable only with `models`
   * where the backend can enforce it, and expiring by itself `ttlMinutes` from now even if the
   * controller never gets to settle it.
   */
  async mint(runId: string, limitUsd: number, ttlMinutes: number, models: readonly string[]): Promise<MintedKey> {
    const backend = this.keys.active;
    const expiresAt = new Date(this.clock.now().getTime() + ttlMinutes * 60_000);
    const key = await backend.create(`${RUN_KEY_PREFIX}${runId}`, limitUsd, expiresAt, models);
    return { backend: backend.backend, ...key };
  }

  /** Where runners send their requests with a key of `backend`. */
  baseUrl(backend: LlmBackend): string {
    return this.keys.of(backend).baseUrl;
  }

  /** How long to wait after freezing a key of `backend` before its usage is worth reading. */
  usageLagMs(backend: LlmBackend): number {
    return this.keys.of(backend).usageLagMs;
  }

  /** What the key spent since `since` (a little before the run started). */
  async usage(ref: RunKeyRef, since: Date): Promise<UsdMicros> {
    return toMicros(await this.keys.of(ref.backend).spentSince(ref.hash, since));
  }

  /** Spending stops now: the next request with the key is refused. Idempotent. */
  async freeze(ref: RunKeyRef): Promise<void> {
    await this.keys.of(ref.backend).disable(ref.hash);
  }

  /** Best effort, for cleanup paths: never throws (the sweeper is the safety net); a missing key is fine. */
  async revoke(ref: RunKeyRef): Promise<void> {
    try {
      const keys = this.keys.of(ref.backend);
      await keys.disable(ref.hash);
      await keys.delete(ref.hash);
    } catch (error: unknown) {
      if (httpStatusOf(error) === 404) return;
      this.logger.error(`revoking ${ref.backend} key ${ref.hash.slice(0, 8)}… failed: ${describeError(error)}`);
    }
  }

  /** Every run key on every configured backend, for the sweeper. */
  async runKeys(): Promise<SweepableKey[]> {
    const found: SweepableKey[] = [];
    for (const keys of this.keys.all) {
      for (const key of await keys.listByPrefix(RUN_KEY_PREFIX)) found.push({ ...key, backend: keys.backend });
    }
    return found;
  }
}

function httpStatusOf(error: unknown): number | undefined {
  return error instanceof UpstreamError ? error.status : undefined;
}
