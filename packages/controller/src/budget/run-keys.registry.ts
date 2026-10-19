import type { OnModuleInit } from "@nestjs/common";
import type { LlmBackend, RunKeys } from "./run-keys.ts";

/**
 * Every configured key backend. `active` mints the keys of new runs; the others stay reachable so
 * runs minted before a backend switch are still frozen, settled and swept where their key lives.
 */
export class RunKeysRegistry implements OnModuleInit {
  private readonly byBackend: ReadonlyMap<LlmBackend, RunKeys>;

  constructor(
    readonly activeBackend: LlmBackend,
    backends: readonly RunKeys[],
  ) {
    this.byBackend = new Map(backends.map((keys) => [keys.backend, keys]));
    if (!this.byBackend.has(activeBackend)) throw new Error(`LLM backend "${activeBackend}" is selected but not configured`);
  }

  /** Every backend must answer before the controller accepts work. */
  async onModuleInit(): Promise<void> {
    for (const keys of this.byBackend.values()) await keys.init();
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
