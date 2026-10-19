import type { OnApplicationBootstrap, OnModuleInit } from "@nestjs/common";
import type { LlmBackend, RunKeys } from "./run-keys.ts";

/**
 * Every configured key backend. `active` mints the keys of new runs; the others stay reachable so
 * runs minted before a backend switch are still frozen, settled and swept where their key lives.
 */
export class RunKeysRegistry implements OnModuleInit, OnApplicationBootstrap {
  private readonly byBackend: ReadonlyMap<LlmBackend, RunKeys>;

  /** `configuredModels` lists every model the loaded configuration can give a run. */
  constructor(
    readonly activeBackend: LlmBackend,
    backends: readonly RunKeys[],
    private readonly configuredModels: () => readonly string[] = () => [],
  ) {
    this.byBackend = new Map(backends.map((keys) => [keys.backend, keys]));
    if (!this.byBackend.has(activeBackend)) throw new Error(`LLM backend "${activeBackend}" is selected but not configured`);
  }

  /** Every backend must answer before the controller accepts work. */
  async onModuleInit(): Promise<void> {
    for (const keys of this.byBackend.values()) await keys.init();
  }

  /**
   * Refuses to start when the active backend can't bill a configured model (e.g. names written for
   * another backend): every run would otherwise fail at launch. After a config reload, minting
   * still refuses unpriced models one run at a time.
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
