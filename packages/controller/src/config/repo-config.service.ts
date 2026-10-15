import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import type { GitHubLogin, RepoConfig } from "@open-macaron/contracts";
import { describeError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "./env.ts";
import { type ConfigSnapshot, loadConfigTree, repoKey } from "./config-tree.ts";

/**
 * The trusted configuration. Loaded at boot (the process refuses to start on invalid config)
 * and reloaded on SIGHUP, sent by deploy.sh; an invalid reload keeps the previous snapshot.
 */
@Injectable()
export class RepoConfigService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RepoConfigService.name);
  private current: ConfigSnapshot | undefined;
  private readonly onHangup = (): void => {
    void this.reload();
  };

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async onModuleInit(): Promise<void> {
    this.current = await loadConfigTree(this.env.CONFIG_DIR);
    this.logger.log(`configuration loaded: ${String(this.current.repos.size)} repositories`);
    process.on("SIGHUP", this.onHangup);
  }

  onApplicationShutdown(): void {
    process.off("SIGHUP", this.onHangup);
  }

  async reload(): Promise<void> {
    try {
      this.current = await loadConfigTree(this.env.CONFIG_DIR);
      this.logger.log(`configuration reloaded: ${String(this.current.repos.size)} repositories`);
    } catch (error: unknown) {
      this.logger.error(`configuration reload rejected, keeping the previous one: ${describeError(error)}`);
    }
  }

  get snapshot(): ConfigSnapshot {
    if (this.current === undefined) throw new Error("configuration not loaded yet");
    return this.current;
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
}
