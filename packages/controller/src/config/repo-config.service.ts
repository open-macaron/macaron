import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import {
  type CommitSha,
  type ConfigSnapshot,
  ConfigTreeError,
  type GitHubLogin,
  loadConfigTree,
  parseConfigTree,
  type PublishedConfig,
  type RepoConfig,
  repoKey,
} from "@open-macaron/contracts";
import { describeError, UpstreamError } from "../common/errors.ts";
import { ConfigSnapshotStore } from "./config-snapshots.store.ts";
import { APP_ENV, type AppEnv } from "./env.ts";
import { PublishedConfigClient } from "./published-config.client.ts";

/** A check a configuration must pass before it replaces the live one; returns its problems. */
export type ConfigCheck = (snapshot: ConfigSnapshot) => Promise<readonly string[]>;

export type ReloadResult =
  | { readonly applied: true; readonly commit: CommitSha | undefined }
  /** `retry`: worth trying again (the source was unreachable, or not serving the expected commit yet). */
  | { readonly applied: false; readonly retry: boolean; readonly reason: string };

/**
 * The trusted configuration: open-macaron/config's snapshot on GitHub Pages when CONFIG_URL is set,
 * else the CONFIG_DIR tree. A configuration replaces the live one only if it is valid and passes
 * every registered check; an applied snapshot is stored, and is what boot falls back to when Pages
 * can't serve a valid one. With nothing valid to load, the process refuses to start.
 */
@Injectable()
export class RepoConfigService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RepoConfigService.name);
  private current: ConfigSnapshot | undefined;
  private currentCommit: CommitSha | undefined;
  private readonly checks: ConfigCheck[] = [];
  private readonly onHangup = (): void => {
    void this.reload();
  };

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly published: PublishedConfigClient,
    private readonly store: ConfigSnapshotStore,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.publishedConfig === undefined) {
      this.current = await loadConfigTree(this.env.CONFIG_DIR);
      this.logger.log(`configuration loaded from ${this.env.CONFIG_DIR}: ${String(this.current.repos.size)} repositories`);
    } else {
      await this.loadPublished();
    }
    process.on("SIGHUP", this.onHangup);
  }

  onApplicationShutdown(): void {
    process.off("SIGHUP", this.onHangup);
  }

  /** Adds a check every later configuration must pass (e.g. the active LLM backend prices its models). */
  addCheck(check: ConfigCheck): void {
    this.checks.push(check);
  }

  /**
   * Loads the configuration again and applies it if it is valid and passes the checks; otherwise
   * keeps the live one. `commit`: the published commit expected (a Pages deployment reported it).
   */
  async reload(commit?: CommitSha): Promise<ReloadResult> {
    let snapshot: ConfigSnapshot;
    let published: PublishedConfig | undefined;
    try {
      if (this.env.publishedConfig === undefined) {
        snapshot = await loadConfigTree(this.env.CONFIG_DIR);
      } else {
        const fetched = await this.published.fetch(commit);
        if (!fetched.changed || fetched.config.commit === this.currentCommit) return { applied: false, retry: false, reason: "unchanged" };
        published = fetched.config;
        snapshot = parseConfigTree(new Map(Object.entries(published.files)));
      }
      const problems = (await Promise.all(this.checks.map((check) => check(snapshot)))).flat();
      if (problems.length > 0) throw new ConfigTreeError(problems);
    } catch (error: unknown) {
      const reason = describeError(error);
      this.logger.error(`configuration ${commit ?? ""} rejected, keeping ${this.currentCommit ?? "the live one"}: ${reason}`);
      return { applied: false, retry: error instanceof UpstreamError, reason };
    }
    this.current = snapshot;
    this.currentCommit = published?.commit;
    if (published !== undefined) await this.remember(published);
    this.logger.log(`configuration ${published?.commit ?? this.env.CONFIG_DIR} applied: ${String(snapshot.repos.size)} repositories`);
    return { applied: true, commit: published?.commit };
  }

  get snapshot(): ConfigSnapshot {
    if (this.current === undefined) throw new Error("configuration not loaded yet");
    return this.current;
  }

  /** The published commit live now; undefined when the configuration comes from CONFIG_DIR. */
  get commit(): CommitSha | undefined {
    return this.currentCommit;
  }

  /** The repo's merged config, or undefined when the repo isn't trusted. */
  repo(fullName: string): RepoConfig | undefined {
    return this.snapshot.repos.get(repoKey(fullName));
  }

  /** May `login` trigger work on `repo`? Users can; known review bots only for review loops. */
  trigger(fullName: string, login: string): "user" | "bot" | undefined {
    const config = this.repo(fullName);
    if (config === undefined) return undefined;
    const same = (candidate: GitHubLogin) => candidate.toLowerCase() === login.toLowerCase();
    if (config.users.some(same)) return "user";
    if (config.bots.some(same)) return "bot";
    return undefined;
  }

  /** Boot: the published snapshot, else the one applied last; checks registered later (pricing) run at bootstrap. */
  private async loadPublished(): Promise<void> {
    let failure: string;
    try {
      const fetched = await this.published.fetch();
      if (!fetched.changed) throw new Error("no snapshot served");
      this.current = parseConfigTree(new Map(Object.entries(fetched.config.files)));
      this.currentCommit = fetched.config.commit;
      await this.remember(fetched.config);
      this.logger.log(`configuration ${fetched.config.commit} loaded: ${String(this.current.repos.size)} repositories`);
      return;
    } catch (error: unknown) {
      failure = describeError(error);
    }
    const stored = await this.store.latest();
    if (stored === undefined) throw new Error(`no configuration to start with: the published one failed (${failure}) and none was applied before`);
    this.current = parseConfigTree(new Map(Object.entries(stored.files)));
    this.currentCommit = stored.commit;
    this.logger.warn(`published configuration unavailable (${failure}): starting on ${stored.commit}, applied before`);
  }

  /** A failure to record is logged, not fatal: the configuration is valid and live either way. */
  private async remember(config: PublishedConfig): Promise<void> {
    try {
      await this.store.applied(config);
    } catch (error: unknown) {
      this.logger.error(`could not record configuration ${config.commit}: ${describeError(error)}`);
    }
  }
}
