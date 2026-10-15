import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type BootstrapResponse,
  DispatchInputs,
  type Mode,
  type RepoConfig,
  type RunContext,
  Ticket,
} from "@open-macaron/contracts";
import { z } from "zod";
import { BudgetService } from "../budget/budget.service.ts";
import { decideSettlement, SETTLE_RECHECK_MS } from "../budget/settlement.ts";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { toMicros, type UsdMicros } from "../common/money.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { GH_ORG, type GitHub } from "../github/github.ts";
import { Jobs } from "../jobs/jobs.ts";
import { repoRef } from "../github/repo-ref.ts";
import { gate } from "../publish/gate.ts";
import { Publisher } from "../publish/publisher.ts";
import { ArtifactDownloader, ArtifactInvalid, readArtifact } from "./artifact.ts";
import { OidcVerifier } from "./oidc-verifier.ts";
import { runUrl } from "./run-url.ts";
import { type RunRecord, RunsRepository, type ThreadRecord } from "./runs.repository.ts";

export interface LaunchRequest {
  readonly config: RepoConfig;
  readonly thread: ThreadRecord;
  readonly mode: Mode;
  readonly context: RunContext;
}

export type LaunchOutcome =
  | { readonly kind: "launched"; readonly run: RunRecord }
  | { readonly kind: "queued"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string };

/** A finished run asking for a follow-up run in another mode. */
export interface Escalation {
  readonly thread: ThreadRecord;
  readonly from: RunRecord;
  readonly mode: Mode;
}

const DispatchDetails = z.object({ workflow_run_id: z.int().positive() });

/** OpenRouter reports usage ~25 s late (measured); the final read waits comfortably longer. */
export const SETTLE_DELAY_MS = 90_000;

/** Keys outlive the job by this margin before OpenRouter expires them on its own. */
const KEY_GRACE_MINUTES = 15;

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * A run's whole life: launch (caps → key → dispatch), bootstrap (OIDC → one-time key hand-over),
 * completion (settle cost → artifact → Gate → publish) and abort. Every money decision is here.
 */
@Injectable()
export class RunLauncher {
  private readonly logger = new Logger(RunLauncher.name);

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GH_ORG) private readonly gh: GitHub,
    private readonly runs: RunsRepository,
    private readonly budget: BudgetService,
    private readonly config: RepoConfigService,
    private readonly oidc: OidcVerifier,
    private readonly artifacts: ArtifactDownloader,
    private readonly publisher: Publisher,
    private readonly jobs: Jobs,
    private readonly clock: Clock,
  ) {}

  async launch(request: LaunchRequest): Promise<LaunchOutcome> {
    const refusal = await this.refusal(request);
    if (refusal !== undefined) return refusal;

    const { config, thread, mode, context } = request;
    const limitUsd = config.budgets[mode];
    const run = await this.runs.createRun({
      threadId: thread.id,
      ticket: Ticket.parse(`t_${randomBytes(32).toString("base64url")}`),
      mode,
      harness: config.harness,
      model: config.model,
      context,
      limitMicros: toMicros(limitUsd),
    });

    let keyHash: string | undefined;
    let dispatched: RunRecord;
    try {
      const key = await this.budget.mint(run.id, limitUsd, config.timeoutMinutes + KEY_GRACE_MINUTES);
      keyHash = key.hash;
      await this.runs.attachKey(run.id, key.hash, key.key);
      const ghRunId = await this.dispatch(run, config, context);
      await this.runs.markDispatched(run.id, ghRunId);
      this.logger.log(`run ${run.id} (${thread.repo}#${String(thread.number)} loop ${String(run.loop)} ${mode}) dispatched as ${String(ghRunId)}`);
      dispatched = { ...run, status: "dispatched", ghRunId, keyHash: key.hash };
    } catch (error: unknown) {
      if (keyHash !== undefined) await this.budget.revoke(keyHash);
      // The key never reached a runner: nothing was spent.
      await this.runs.finish(run.id, { status: "failed", failure: `launch failed: ${describeError(error)}` }, this.clock.now());
      await this.runs.settle(run.id, 0, this.attribution(config), this.clock.now());
      throw error;
    }
    // The run is under way whatever happens to this progress note.
    try {
      await this.publisher.reportStarted(thread, dispatched, runUrl(this.env, dispatched.ghRunId));
    } catch (error: unknown) {
      this.logger.warn(`reporting the start of run ${run.id} failed: ${describeError(error)}`);
    }
    return { kind: "launched", run: dispatched };
  }

  /** POST /v1/bootstrap: the only way a key leaves the controller. */
  async bootstrap(oidcToken: string, ticket: Ticket): Promise<BootstrapResponse> {
    const verified = await this.oidc.verify(oidcToken);
    const { key, run } = await this.runs.redeem(ticket, verified.runId, this.clock.now());
    this.logger.log(`run ${run.id} bootstrapped by workflow run ${String(verified.runId)}`);
    return { openRouterKey: key, harness: this.harnessOf(run), model: run.model, context: run.context };
  }

  /** workflow_run completed (webhook or reconcile). Idempotent. Returns the escalation the run asked for, if any. */
  async complete(ghRunId: number, conclusion: string | null): Promise<Escalation | undefined> {
    const run = await this.runs.byGhRunId(ghRunId);
    if (run?.finishedAt !== null) return undefined;
    const thread = await this.runs.threadById(run.threadId);
    const config = this.config.repo(thread.repo);
    const url = runUrl(this.env, ghRunId);

    // Spending stops now; the cost is settled in the background once OpenRouter has reported it.
    if (run.keyHash !== null) await this.budget.freeze(run.keyHash);
    await this.jobs.settleCost(run.id, SETTLE_DELAY_MS);

    const fail = async (reason: string): Promise<Escalation | undefined> => {
      const closed = await this.runs.finish(run.id, { status: "failed", failure: reason }, this.clock.now());
      if (closed) await this.publisher.reportFailure({ run, thread, reason, runUrl: url });
      return undefined;
    };

    if (conclusion !== "success") return fail(`the run ended with "${conclusion ?? "unknown"}"`);
    if (config === undefined) return fail("the repository is no longer in the trusted configuration");

    let artifact;
    try {
      const zip = await this.artifacts.download(ghRunId);
      if (zip === undefined) return await fail("the run produced no result");
      artifact = readArtifact(zip);
    } catch (error: unknown) {
      if (error instanceof ArtifactInvalid) return fail(`the run's result was unreadable: ${error.message}`);
      throw error;
    }

    const verdict = await gate({ mode: run.mode, context: run.context, result: artifact.result, changes: artifact.changes, media: artifact.media });
    if (!verdict.ok) {
      this.logger.warn(`run ${run.id} refused by the Gate: ${verdict.violations.join("; ")}`);
      return fail(`the result was refused by policy (${verdict.violations.slice(0, 3).join("; ")})`);
    }

    const closed = await this.runs.finish(run.id, { status: "completed", failure: null }, this.clock.now());
    if (!closed) return undefined;
    try {
      await this.publisher.publish({ run, thread, config, publishable: verdict.publishable, runUrl: url ?? "", attachmentUrls: new Map() });
    } catch (error: unknown) {
      this.logger.error(`publishing run ${run.id} failed: ${describeError(error)}`);
      await this.publisher.reportFailure({ run, thread, reason: "publishing the result failed; maintainers have been notified", runUrl: url });
      return undefined;
    }
    const { result } = verdict.publishable;
    if (result.action !== "escalate" || result.escalateTo === undefined) return undefined;
    return { thread: await this.runs.threadById(thread.id), from: run, mode: result.escalateTo };
  }

  /** /stop, watchdog, timeout: spending stops now, then the workflow is cancelled. */
  async abort(run: RunRecord, reason: string): Promise<void> {
    const thread = await this.runs.threadById(run.threadId);
    if (run.keyHash !== null) await this.budget.freeze(run.keyHash);
    await this.jobs.settleCost(run.id, SETTLE_DELAY_MS);
    if (run.ghRunId !== null) {
      await this.gh.rest.actions.cancelWorkflowRun({ ...repoRef(this.env.RUNNER_REPO), run_id: run.ghRunId }).catch((error: unknown) => {
        this.logger.warn(`cancelling workflow run ${String(run.ghRunId)} failed: ${describeError(error)}`);
      });
    }
    const closed = await this.runs.finish(run.id, { status: "aborted", failure: reason }, this.clock.now());
    if (closed) await this.publisher.reportFailure({ run, thread, reason, runUrl: runUrl(this.env, run.ghRunId) });
  }

  /**
   * settle-cost job: reads the frozen key's usage and either records the final cost (ledger, key
   * deleted, cost table refreshed) or reschedules itself with this reading (see decideSettlement).
   */
  async settle(runId: string, previousMicros: UsdMicros | undefined): Promise<void> {
    const run = await this.runs.byId(runId);
    if (run.settledAt !== null) return;
    const now = this.clock.now();
    const since = new Date(run.createdAt.getTime() - 5 * 60_000);
    const observedMicros: UsdMicros = run.keyHash === null ? 0 : await this.budget.usage(run.keyHash, since);
    const decision = decideSettlement({
      redeemed: run.redeemedAt !== null,
      observedMicros,
      previousMicros,
      sinceFinishMs: now.getTime() - (run.finishedAt ?? run.createdAt).getTime(),
    });
    if (decision.kind === "recheck") {
      await this.jobs.settleCost(run.id, SETTLE_RECHECK_MS, decision.observedMicros);
      return;
    }
    const thread = await this.runs.threadById(run.threadId);
    const config = this.config.repo(thread.repo);
    const attribution = config === undefined ? { repo: thread.repo, project: "unknown" } : this.attribution(config);
    if (await this.runs.settle(run.id, decision.costMicros, attribution, now)) {
      this.logger.log(`run ${run.id} cost ${String(decision.costMicros)} µ$`);
      if (run.keyHash !== null) await this.budget.revoke(run.keyHash);
      await this.publisher.refreshCost(await this.runs.threadById(thread.id));
    }
  }

  private async refusal(request: LaunchRequest): Promise<LaunchOutcome | undefined> {
    const { config, thread, mode } = request;
    if (!this.env.MACARON_ENABLED) return { kind: "refused", reason: "the bot is paused by its maintainers" };

    const limit = toMicros(config.budgets[mode]);
    const caps = config.caps;
    if (mode === "address_review" && thread.loops >= caps.reviewLoops) {
      return { kind: "refused", reason: `this thread reached its limit of ${String(caps.reviewLoops)} review loops` };
    }
    if ((await this.runs.spentOnThread(thread.id)) + (await this.runs.reservedMicros({ threadId: thread.id })) + limit > toMicros(caps.perThreadUsd)) {
      return { kind: "refused", reason: "this thread reached its budget" };
    }
    const now = this.clock.now();
    const repoCommitted = (await this.runs.spentOnRepoSince(thread.repo, monthStart(now))) + (await this.runs.reservedMicros({ repo: thread.repo }));
    if (repoCommitted + limit > toMicros(caps.perRepoMonthUsd)) return { kind: "refused", reason: "this repository reached its monthly budget" };

    const project = this.config.snapshot.projects.get(config.project);
    if (project !== undefined && (await this.runs.spentOnProjectSince(project.project, monthStart(now))) + limit > toMicros(project.budget.monthUsd)) {
      return { kind: "refused", reason: "this project reached its monthly budget" };
    }
    if ((await this.runs.activeCount()) >= this.config.snapshot.global.concurrency.global) {
      return { kind: "queued", reason: "all runners are busy" };
    }
    return undefined;
  }

  private async dispatch(run: RunRecord, config: RepoConfig, context: RunContext): Promise<number> {
    const inputs = DispatchInputs.parse({
      ticket: run.ticket,
      repo: context.repo,
      "base-sha": context.baseSha,
      fork: `${this.env.GITHUB_BOT_LOGIN}/${config.fork}`,
      branch: context.branch,
      "env-json": JSON.stringify(config.environment),
      "runs-on": config.runsOn,
      "timeout-minutes": String(config.timeoutMinutes),
      "full-environment": String(run.mode !== "triage"),
      harness: config.harness,
      "controller-url": this.env.PUBLIC_URL,
    });
    const response = await this.gh.rest.actions.createWorkflowDispatch({
      ...repoRef(this.env.RUNNER_REPO),
      workflow_id: this.env.RUNNER_WORKFLOW,
      ref: "main",
      inputs,
      return_run_details: true,
    });
    // Octokit's method types predate `return_run_details` (they only know the 204 reply): validate at runtime.
    const details = DispatchDetails.safeParse(response.data);
    if (!details.success) throw new Error(`workflow dispatch returned ${String(response.status)} without run details`);
    return details.data.workflow_run_id;
  }

  private harnessOf(run: RunRecord): BootstrapResponse["harness"] {
    const config = this.config.repo(run.context.repo);
    return config?.harness ?? "claude";
  }

  private attribution(config: RepoConfig): { repo: string; project: string } {
    return { repo: config.repo, project: config.project };
  }
}
