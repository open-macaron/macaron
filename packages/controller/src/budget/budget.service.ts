import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { Clock } from "../common/clock.ts";
import { describeError, UpstreamError } from "../common/errors.ts";
import { toMicros, type UsdMicros } from "../common/money.ts";
import { CONFIGURED_MODELS } from "../config/configured-models.ts";
import { type KeyStatus, RunKeys, type RunLimits, type TokenUsage, type Upstream } from "./run-keys.ts";

/** Prefix of every key we mint; the sweeper only ever touches keys with this prefix. */
export const RUN_KEY_PREFIX = "macaron-run-";

/** A run's key as the runs table records it: the gateway's id for it. */
export interface RunKeyRef {
  readonly hash: string;
}

export interface MintedKey extends RunKeyRef {
  /** The bearer key, held until the run's ticket is redeemed. */
  readonly key: string;
}

@Injectable()
export class BudgetService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(BudgetService.name);

  /** `configuredModels` lists every model the loaded configuration can give a run. */
  constructor(
    private readonly keys: RunKeys,
    private readonly clock: Clock,
    @Inject(CONFIGURED_MODELS) private readonly configuredModels: () => readonly string[] = () => [],
  ) {}

  /** The gateway must answer before the controller accepts work. */
  async onModuleInit(): Promise<void> {
    await this.keys.init();
  }

  /**
   * Refuses to start when a configured model can't be billed: every run would otherwise fail at
   * launch. A reloaded configuration goes through the same check (registered on RepoConfigService);
   * minting still refuses an unbillable model.
   */
  async onApplicationBootstrap(): Promise<void> {
    const unbillable = await this.keys.unbillable(this.configuredModels());
    if (unbillable.length > 0) throw new Error(`the LLM gateway has no price or free mark for configured models: ${unbillable.join(", ")}`);
  }

  /**
   * A key for one run, over `upstream` (the payer's endpoint and key): capped at `limits`, usable
   * only with `models`, and expiring by itself `ttlMinutes` from now even if the controller never
   * gets to settle it.
   */
  async mint(runId: string, limits: RunLimits, ttlMinutes: number, models: readonly string[], upstream: Upstream): Promise<MintedKey> {
    const expiresAt = new Date(this.clock.now().getTime() + ttlMinutes * 60_000);
    return this.keys.create(`${RUN_KEY_PREFIX}${runId}`, limits, expiresAt, models, upstream);
  }

  /** Where runners send their requests with a run key. */
  get baseUrl(): string {
    return this.keys.baseUrl;
  }

  /** How long to wait after freezing a key before its usage is worth reading. */
  get usageLagMs(): number {
    return this.keys.usageLagMs;
  }

  /** What the key spent since `since` (a little before the run started). */
  async usage(ref: RunKeyRef, since: Date): Promise<UsdMicros> {
    return toMicros(await this.keys.spentSince(ref.hash, since));
  }

  /**
   * The key's token counter, when it has a cap. Best effort: naming an exhausted budget in a
   * failure message must not turn a gateway hiccup into one, so unreadable is undefined.
   */
  async tokenUsage(ref: RunKeyRef): Promise<TokenUsage | undefined> {
    try {
      return await this.keys.tokenUsage(ref.hash);
    } catch (error: unknown) {
      this.logger.warn(`reading the token usage of key ${ref.hash.slice(0, 8)}… failed: ${describeError(error)}`);
      return undefined;
    }
  }

  /** Spending stops now: the next request with the key is refused. Idempotent. */
  async freeze(ref: RunKeyRef): Promise<void> {
    await this.keys.disable(ref.hash);
  }

  /** Best effort, for cleanup paths: never throws (the sweeper is the safety net); a missing key is fine. */
  async revoke(ref: RunKeyRef): Promise<void> {
    try {
      await this.keys.disable(ref.hash);
      await this.keys.delete(ref.hash);
    } catch (error: unknown) {
      if (httpStatusOf(error) === 404) return;
      this.logger.error(`revoking key ${ref.hash.slice(0, 8)}… failed: ${describeError(error)}`);
    }
  }

  /** Users' keys left on the gateway by an interrupted mint, except the runs `keep` names: removed, for the sweeper. */
  async sweepUpstreamKeys(keep: ReadonlySet<string>): Promise<string[]> {
    try {
      return await this.keys.sweepUpstreamKeys(RUN_KEY_PREFIX, keep);
    } catch (error: unknown) {
      this.logger.error(`sweeping upstream keys failed: ${describeError(error)}`);
      return [];
    }
  }

  /** Every run key, for the sweeper: a failure is logged and finds none. */
  async runKeys(): Promise<KeyStatus[]> {
    try {
      return await this.keys.listByPrefix(RUN_KEY_PREFIX);
    } catch (error: unknown) {
      this.logger.error(`listing run keys failed: ${describeError(error)}`);
      return [];
    }
  }
}

function httpStatusOf(error: unknown): number | undefined {
  return error instanceof UpstreamError ? error.status : undefined;
}
