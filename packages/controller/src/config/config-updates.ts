import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigPublishedJob, Jobs, Queue } from "../jobs/jobs.ts";
import { APP_ENV, type AppEnv } from "./env.ts";
import { RepoConfigService } from "./repo-config.service.ts";

/**
 * Applies open-macaron/config's new commits as its Pages deployments report them (webhook), with
 * the housekeeping reconcile as the safety net for a missed delivery.
 */
@Injectable()
export class ConfigUpdates implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly jobs: Jobs,
    private readonly config: RepoConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.publishedConfig === undefined) return;
    await this.jobs.work(Queue.configPublished, ConfigPublishedJob, async ({ commit }) => {
      const result = await this.config.reload(commit);
      // Thrown, so pg-boss tries again: Pages may not serve the new commit everywhere yet.
      if (!result.applied && result.retry) throw new Error(result.reason);
    });
  }

  /** Revalidates the published snapshot (a 304 when unchanged); for deliveries GitHub delayed or lost. */
  async revalidate(): Promise<void> {
    if (this.env.publishedConfig !== undefined) await this.config.reload();
  }
}
