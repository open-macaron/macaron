import { type ConfigSnapshot, type PublishedConfig } from "@open-macaron/contracts";
import { type Clock } from "../../src/common/clock.ts";
import { ConfigSnapshotStore } from "../../src/config/config-snapshots.store.ts";
import type { AppEnv } from "../../src/config/env.ts";
import { OnboardingNotice } from "../../src/config/onboarding-notice.ts";
import { PublishedConfigClient } from "../../src/config/published-config.client.ts";
import { RepoConfigService } from "../../src/config/repo-config.service.ts";
import type { BotIdentity } from "../../src/github/bot-identity.ts";
import type { GitHub } from "../../src/github/github.ts";
import { Jobs } from "../../src/jobs/jobs.ts";
import { ForkRegistry, type ForkRow, ForkStore } from "../../src/publish/fork-registry.ts";

export class MemoryForkStore extends ForkStore {
  readonly rows = new Map<number, ForkRow>();

  override byUpstream(upstreamId: number): Promise<ForkRow | undefined> {
    return Promise.resolve(this.rows.get(upstreamId));
  }

  override readyName(key: string): Promise<string | undefined> {
    return Promise.resolve([...this.rows.values()].find((row) => row.upstreamKey === key && row.readyAt !== null)?.forkName);
  }

  override record(row: Omit<ForkRow, "readyAt">): Promise<void> {
    for (const [id, other] of this.rows) if (other.upstreamKey === row.upstreamKey && id !== row.upstreamId) this.rows.delete(id);
    this.rows.set(row.upstreamId, { ...row, readyAt: this.rows.get(row.upstreamId)?.readyAt ?? null });
    return Promise.resolve();
  }

  override markReady(upstreamId: number): Promise<boolean> {
    const row = this.rows.get(upstreamId);
    if (row?.readyAt !== null) return Promise.resolve(false);
    this.rows.set(upstreamId, { ...row, readyAt: new Date() });
    return Promise.resolve(true);
  }

  /** A fork already onboarded. */
  ready(upstreamKey: string, forkName: string, upstreamId = this.rows.size + 1): this {
    this.rows.set(upstreamId, { upstreamId, upstreamKey, forkId: 1000 + upstreamId, forkName, readyAt: new Date() });
    return this;
  }
}

class NoSnapshots extends ConfigSnapshotStore {
  override latest(): Promise<PublishedConfig | undefined> {
    return Promise.resolve(undefined);
  }

  override applied(): Promise<void> {
    return Promise.resolve();
  }
}

/** The configuration service holding `snapshot`, never loaded. */
export function fixedConfig(env: AppEnv, snapshot: ConfigSnapshot): RepoConfigService {
  return new (class extends RepoConfigService {
    override get snapshot(): ConfigSnapshot {
      return snapshot;
    }
  })(env, new PublishedConfigClient(env), new NoSnapshots());
}

/** A registry over `store`, never started: tests call `ensure` and `of` themselves. */
export function forkRegistry(options: {
  readonly gh: GitHub;
  readonly bot: BotIdentity;
  readonly env: AppEnv;
  readonly clock: Clock;
  readonly store?: ForkStore;
  readonly config?: RepoConfigService;
}): ForkRegistry {
  const config = options.config ?? new RepoConfigService(options.env, new PublishedConfigClient(options.env), new NoSnapshots());
  const notice = new OnboardingNotice(options.gh, options.env, config, options.clock);
  return new ForkRegistry(options.gh, options.bot, options.store ?? new MemoryForkStore(), config, new Jobs(options.env), notice);
}
