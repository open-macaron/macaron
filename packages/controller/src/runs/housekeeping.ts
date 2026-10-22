import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { MAX_TIMEOUT_MINUTES } from "@open-macaron/contracts";
import { BudgetService, RUN_KEY_PREFIX } from "../budget/budget.service.ts";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { ConfigUpdates } from "../config/config-updates.ts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { GH_ORG, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";
import { Jobs, NoPayload, Queue, SettleCostJob } from "../jobs/jobs.ts";
import { SETTLE_MAX_WAIT_MS } from "../budget/settlement.ts";
import { KEY_GRACE_MINUTES, RunLauncher } from "./run-launcher.ts";
import { RunsRepository } from "./runs.repository.ts";

/** A dispatch whose run id never got recorded is given up after this long. */
const UNBOUND_TIMEOUT_MS = 10 * 60_000;
/** Runs are aborted this long after their configured timeout, if GitHub hasn't ended them. */
const TIMEOUT_GRACE_MS = 10 * 60_000;
/**
 * Keys older than this are deleted whatever their run's state: no run lives that long. Derived from
 * the longest allowed run, its key's grace and settlement's longest wait, plus an hour: deleting the
 * key of a run that is still settling would leave it unsettled for good (Bifrost reads usage from the key).
 */
export const KEY_MAX_AGE_MS = (MAX_TIMEOUT_MINUTES + KEY_GRACE_MINUTES + 60) * 60_000 + SETTLE_MAX_WAIT_MS;

/**
 * Safety nets, scheduled by pg-boss (one instance runs each tick):
 * - reconcile: completions missed while the controller was down, runs that never started, timeouts,
 *   and a published configuration whose deployment webhook didn't arrive;
 * - sweep: run keys that outlived their run, on every configured backend (keys also expire on their own).
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
    private readonly config: RepoConfigService,
    private readonly configUpdates: ConfigUpdates,
    private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(Queue.reconcile, NoPayload, () => this.reconcile());
    await this.jobs.work(Queue.sweepKeys, NoPayload, () => this.sweepKeys());
    await this.jobs.work(Queue.settleCost, SettleCostJob, ({ runId, previousMicros }) => this.launcher.settle(runId, previousMicros));
  }

  async reconcile(): Promise<void> {
    await this.configUpdates.revalidate();
    // Finished runs whose cost isn't in the ledger get a settle-cost job (deduplicated by run id),
    // in case one was lost.
    for (const run of await this.runs.unsettled()) {
      if (run.finishedAt !== null) await this.jobs.settleCost(run.id, 0);
    }
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
    // Keys of runs still running or awaiting their cost settlement are kept.
    const active = new Set((await this.runs.unsettled()).map((run) => `${RUN_KEY_PREFIX}${run.id}`));
    const now = this.clock.now().getTime();
    for (const key of await this.budget.runKeys()) {
      if (!active.has(key.name) || now - key.createdAt.getTime() > KEY_MAX_AGE_MS) {
        this.logger.warn(`deleting leftover ${key.backend} key ${key.name}`);
        await this.budget.revoke(key);
      }
    }
  }
}
