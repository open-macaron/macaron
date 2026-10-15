import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { BudgetService, RUN_KEY_PREFIX } from "../budget/budget.service.ts";
import { OpenRouterKeys } from "../budget/openrouter-keys.ts";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { GH_ORG, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";
import { Jobs, NoPayload, Queue } from "../jobs/jobs.ts";
import { RunLauncher } from "./run-launcher.ts";
import { RunsRepository } from "./runs.repository.ts";

/** A dispatch whose run id never got recorded is given up after this long. */
const UNBOUND_TIMEOUT_MS = 10 * 60_000;
/** Runs are aborted this long after their configured timeout, if GitHub hasn't ended them. */
const TIMEOUT_GRACE_MS = 10 * 60_000;
/** Keys older than this are deleted whatever their run's state: no run lives that long. */
const KEY_MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * Safety nets, scheduled by pg-boss (one instance runs each tick):
 * - reconcile: completions missed while the controller was down, runs that never started, timeouts;
 * - sweep: OpenRouter run keys that outlived their run (keys also expire on their own).
 */
@Injectable()
export class Housekeeping implements OnApplicationBootstrap {
  private readonly logger = new Logger(Housekeeping.name);

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GH_ORG) private readonly gh: GitHub,
    private readonly jobs: Jobs,
    private readonly runs: RunsRepository,
    private readonly launcher: RunLauncher,
    private readonly budget: BudgetService,
    private readonly keys: OpenRouterKeys,
    private readonly config: RepoConfigService,
    private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(Queue.reconcile, NoPayload, () => this.reconcile());
    await this.jobs.work(Queue.sweepKeys, NoPayload, () => this.sweepKeys());
  }

  async reconcile(): Promise<void> {
    const now = this.clock.now().getTime();
    for (const run of await this.runs.active()) {
      try {
        if (run.ghRunId === null) {
          if (now - run.createdAt.getTime() > UNBOUND_TIMEOUT_MS) await this.launcher.abort(run, "the run never started");
          continue;
        }
        const { data } = await this.gh.rest.actions.getWorkflowRun({ ...repoRef(this.env.RUNNER_REPO), run_id: run.ghRunId });
        if (data.status === "completed") {
          await this.jobs.runCompleted(run.ghRunId, data.conclusion);
          continue;
        }
        const timeoutMinutes = this.config.repo(run.context.repo)?.timeoutMinutes ?? 60;
        if (now - run.createdAt.getTime() > timeoutMinutes * 60_000 + TIMEOUT_GRACE_MS) await this.launcher.abort(run, "the run timed out");
      } catch (error: unknown) {
        this.logger.error(`reconciling run ${run.id} failed: ${describeError(error)}`);
      }
    }
  }

  async sweepKeys(): Promise<void> {
    const active = new Set((await this.runs.active()).map((run) => `${RUN_KEY_PREFIX}${run.id}`));
    const now = this.clock.now().getTime();
    for (const key of await this.keys.listByPrefix(RUN_KEY_PREFIX)) {
      if (!active.has(key.name) || now - key.createdAt.getTime() > KEY_MAX_AGE_MS) {
        this.logger.warn(`deleting leftover key ${key.name}`);
        await this.budget.revoke(key.hash);
      }
    }
  }
}
