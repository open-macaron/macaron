import { Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { describeError } from "../common/errors.ts";
import type { LlmBackend, RunKeys } from "./run-keys.ts";

/**
 * Every configured key backend. `active` mints the keys of new runs; the others stay reachable so
 * runs minted before a backend switch are still frozen, settled and swept where their key lives.
 */
export class RunKeysRegistry implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(RunKeysRegistry.name);
  private readonly byBackend: Map<LlmBackend, RunKeys>;

  /** `configuredModels` lists every model the loaded configuration can give a run. */
  constructor(
    readonly activeBackend: LlmBackend,
    backends: readonly RunKeys[],
    private readonly configuredModels: () => readonly string[] = () => [],
  ) {
    this.byBackend = new Map(backends.map((keys) => [keys.backend, keys]));
    if (!this.byBackend.has(activeBackend)) throw new Error(`LLM backend "${activeBackend}" is selected but not configured`);
  }

  /**
   * The active backend must answer before the controller accepts work. Another one that doesn't
   * (e.g. its keys were disabled) is logged and left out: it only matters for runs minted on it,
   * which then fail to settle (and say so) until it is fixed.
   */
  async onModuleInit(): Promise<void> {
    for (const keys of [...this.byBackend.values()]) {
      try {
        await keys.init();
      } catch (error: unknown) {
        if (keys.backend === this.activeBackend) throw error;
        this.logger.error(`LLM backend "${keys.backend}" doesn't answer and is left out: ${describeError(error)}`);
        this.byBackend.delete(keys.backend);
      }
    }
  }

  /**
   * Refuses to start when the active backend can't bill a configured model (e.g. names written for
   * another backend): every run would otherwise fail at launch. A reloaded configuration goes through
   * the same check (registered on RepoConfigService); minting still refuses an unpriced model.
   */
  async onApplicationBootstrap(): Promise<void> {
    const unpriced = await this.active.unpriced(this.configuredModels());
    if (unpriced.length > 0) {
      throw new Error(`LLM backend "${this.activeBackend}" has no price for configured models: ${unpriced.join(", ")}`);
    }
  }

  get active(): RunKeys {
    return this.of(this.activeBackend);
  }

  get all(): readonly RunKeys[] {
    return [...this.byBackend.values()];
  }

  /** Throws if a run's backend has been unconfigured while it still has a key: that key can't be managed any more. */
  of(backend: LlmBackend): RunKeys {
    const keys = this.byBackend.get(backend);
    if (keys === undefined) throw new Error(`LLM backend "${backend}" is not configured`);
    return keys;
  }
}
