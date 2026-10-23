import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type BootstrapResponse,
  DispatchInputs,
  fullEnvironmentModes,
  type Mode,
  type Platform,
  type RepoConfig,
  runnerFor,
  type RunContext,
  Ticket,
} from "@open-macaron/contracts";
import { z } from "zod";
import { type Asker, capabilityRefusal } from "../accounts/access.ts";
import { UsersService } from "../accounts/users.service.ts";
import { LlmKeysService } from "../keys/llm-keys.service.ts";
import { BudgetService, type RunKeyRef } from "../budget/budget.service.ts";
import type { Route } from "../routing/routes.ts";
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
import { PullDiffReader } from "../review/pull-diff.ts";
import { ArtifactDownloader, ArtifactInvalid, readArtifact } from "./artifact.ts";
import { OidcVerifier } from "./oidc-verifier.ts";
import { runLimitUsd } from "./run-limit.ts";
import { runUrl } from "./run-url.ts";
import { type RunRecord, RunsRepository, type ThreadRecord } from "./runs.repository.ts";

export interface LaunchRequest {
  readonly config: RepoConfig;
  readonly thread: ThreadRecord;
  /** What the run does, and where it answers: stored on the run, followed until it is published. */
  readonly route: Route;
  readonly context: RunContext;
  /** GitHub id of who asked for the run: whose usage it is. */
  readonly triggerGithubId: number | null;
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
  /** Where the run asked the follow-up to go; the escalating run's platform when undefined. */
  readonly platform: Platform | undefined;
}

const DispatchDetails = z.object({ workflow_run_id: z.int().positive() });

/** Keys outlive the job by this margin before their backend expires them on its own. */
export const KEY_GRACE_MINUTES = 15;

/** The run's key, if it got one. */
function keyOf(run: RunRecord): RunKeyRef | undefined {
  return run.keyBackend === null || run.keyHash === null ? undefined : { backend: run.keyBackend, hash: run.keyHash };
}

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
    private readonly diffs: PullDiffReader,
    private readonly jobs: Jobs,
    private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly keys: LlmKeysService,
  ) {}

  async launch(request: LaunchRequest): Promise<LaunchOutcome> {
    const checked = await this.check(request);
    if ("outcome" in checked) return checked.outcome;
    // Last, as it asks the payer's endpoint: whoever asked pays, on their own key.
    const payer = checked.payer;
    const resolved = await this.keys.upstreamFor(payer.userId, `${this.env.PUBLIC_URL}/settings/key`);
    if ("refusal" in resolved) return { kind: "refused", reason: resolved.refusal };
    const { upstream } = resolved;

    const { config, thread, route, context } = request;
    const mode = route.mode;
    const limitUsd = runLimitUsd(config, mode, context);
    const run = await this.runs.createRun({
      threadId: thread.id,
      ticket: Ticket.parse(`t_${randomBytes(32).toString("base64url")}`),
      mode,
      harness: config.harness,
      model: config.models[mode] ?? config.model,
      fastModel: config.fastModel,
      context,
      route,
      limitMicros: toMicros(limitUsd),
      triggerGithubId: request.triggerGithubId,
      payerId: payer.userId,
    });

    let key: RunKeyRef | undefined;
    let dispatched: RunRecord;
    try {
      const minted = await this.budget.mint(run.id, limitUsd, config.timeoutMinutes + KEY_GRACE_MINUTES, [run.model, run.fastModel ?? run.model], upstream);
      key = minted;
      await this.keys.recordUse(payer.userId, run.id, upstream.endpointId, upstream.last4);
      await this.runs.attachKey(run.id, minted);
      const ghRunId = await this.dispatch(run, config, context);
      await this.runs.markDispatched(run.id, ghRunId);
      this.logger.log(`run ${run.id} (${thread.repo}#${String(thread.number)} loop ${String(run.loop)} ${mode}) dispatched as ${String(ghRunId)}`);
      dispatched = { ...run, status: "dispatched", ghRunId, keyBackend: minted.backend, keyHash: minted.hash };
    } catch (error: unknown) {
      if (key !== undefined) await this.budget.revoke(key);
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
    if (run.keyBackend === null) throw new Error(`run ${run.id} has a key but no key backend`);
    this.logger.log(`run ${run.id} bootstrapped by workflow run ${String(verified.runId)}`);
    const config = this.config.repo(run.context.repo);
    return {
      // The fast model fixed at launch: the key's allowlist was built from it, whatever the config says now.
      llm: { baseUrl: this.budget.baseUrl(run.keyBackend), key, fastModel: run.fastModel ?? run.model },
      harness: config?.harness ?? "claude",
      model: run.model,
      context: run.context,
    };
  }

  /** workflow_run completed (webhook or reconcile). Idempotent. Returns the escalation the run asked for, if any. */
  async complete(ghRunId: number, conclusion: string | null): Promise<Escalation | undefined> {
    const run = await this.runs.byGhRunId(ghRunId);
    if (run?.finishedAt !== null) return undefined;
    const thread = await this.runs.threadById(run.threadId);
    const config = this.config.repo(thread.repo);
    const url = runUrl(this.env, ghRunId);

    // Spending stops now; the cost is settled in the background once the backend has reported it.
    await this.stopSpending(run);

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

    // Reviews: the diff comes from GitHub at the reviewed commit, never from the run.
    const review = run.mode === "review" ? run.context.review : undefined;
    const diff = review === undefined ? undefined : await this.diffs.read(run.context.repo, review.baseSha, review.headSha);
    const verdict = await gate({ mode: run.mode, context: run.context, result: artifact.result, changes: artifact.changes, media: artifact.media, diff });
    if (!verdict.ok) {
      this.logger.warn(`run ${run.id} refused by the Gate: ${verdict.violations.join("; ")}`);
      return fail(`the result was refused by policy (${verdict.violations.slice(0, 3).join("; ")})`);
    }

    const closed = await this.runs.finish(run.id, { status: "completed", failure: null }, this.clock.now());
    if (!closed) return undefined;
    try {
      await this.publisher.publish({ run, thread, config, publishable: verdict.publishable, runUrl: url ?? "" });
    } catch (error: unknown) {
      this.logger.error(`publishing run ${run.id} failed: ${describeError(error)}`);
      await this.publisher.reportFailure({ run, thread, reason: "publishing the result failed; maintainers have been notified", runUrl: url });
      return undefined;
    }
    const { result } = verdict.publishable;
    if (result.action !== "escalate" || result.escalateTo === undefined) return undefined;
    return { thread: await this.runs.threadById(thread.id), from: run, mode: result.escalateTo, platform: result.escalateOn };
  }

  /** /stop, watchdog, timeout: spending stops now, then the workflow is cancelled. */
  async abort(run: RunRecord, reason: string): Promise<void> {
    const thread = await this.runs.threadById(run.threadId);
    await this.stopSpending(run);
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
    const key = keyOf(run);
    const observedMicros: UsdMicros = key === undefined ? 0 : await this.budget.usage(key, since);
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
      if (key !== undefined) await this.budget.revoke(key);
      const current = await this.runs.threadById(thread.id);
      await this.publisher.refreshCost(current, run);
      if (run.mode === "review") await this.publisher.refreshReviewCost(current, run, decision.costMicros);
    }
  }

  /** Freezes the run's key and schedules its settlement once the backend's usage has caught up. */
  private async stopSpending(run: RunRecord): Promise<void> {
    const key = keyOf(run);
    if (key !== undefined) await this.budget.freeze(key);
    await this.jobs.settleCost(run.id, key === undefined ? 0 : this.budget.usageLagMs(key.backend));
  }

  /** Who pays for the run, or why it doesn't start now. */
  private async check(request: LaunchRequest): Promise<{ readonly payer: Asker } | { readonly outcome: LaunchOutcome }> {
    const refused = (reason: string): { readonly outcome: LaunchOutcome } => ({ outcome: { kind: "refused", reason } });
    const { config, thread } = request;
    const mode = request.route.mode;
    if (!this.env.MACARON_ENABLED) return refused("the bot is paused by its maintainers");
    // OpenRouter keys spend the workspace's credit: no run may be billed to anyone else than its payer.
    if (this.budget.activeBackend !== "bifrost") return refused("the bot's LLM gateway can't bill users' keys: its maintainers must switch it to Bifrost");
    // The run is for an account (whoever asked, or for escalations and retries, whoever asked first),
    // which must hold the capability its mode needs, and pays for it.
    const asker = request.triggerGithubId === null ? undefined : await this.users.asker(request.triggerGithubId);
    const forbidden = capabilityRefusal(asker, mode, this.env.PUBLIC_URL);
    if (forbidden !== undefined || asker === undefined) return refused(forbidden ?? "this needs an account on macaron");

    const limit = toMicros(runLimitUsd(config, mode, request.context));
    const caps = config.caps;
    if (mode === "address_review" && thread.loops >= caps.reviewLoops) {
      return refused(`this thread reached its limit of ${String(caps.reviewLoops)} review loops`);
    }
    if ((await this.runs.spentOnThread(thread.id)) + (await this.runs.reservedMicros({ threadId: thread.id })) + limit > toMicros(caps.perThreadUsd)) {
      return refused("this thread reached its budget");
    }
    const now = this.clock.now();
    const repoCommitted = (await this.runs.spentOnRepoSince(thread.repo, monthStart(now))) + (await this.runs.reservedMicros({ repo: thread.repo }));
    if (repoCommitted + limit > toMicros(caps.perRepoMonthUsd)) return refused("this repository reached its monthly budget");

    const project = this.config.snapshot.projects.get(config.project);
    if (project !== undefined && (await this.runs.spentOnProjectSince(project.project, monthStart(now))) + limit > toMicros(project.budget.monthUsd)) {
      return refused("this project reached its monthly budget");
    }
    if ((await this.runs.activeCount()) >= this.config.snapshot.global.concurrency.global) {
      return { outcome: { kind: "queued", reason: "all runners are busy" } };
    }
    return { payer: asker };
  }

  private async dispatch(run: RunRecord, config: RepoConfig, context: RunContext): Promise<number> {
    const runsOn = runnerFor(config, context.platform);
    if (runsOn === undefined) throw new Error(`${context.platform} isn't enabled for ${config.repo}`);
    const inputs = DispatchInputs.parse({
      ticket: run.ticket,
      repo: context.repo,
      "base-sha": context.baseSha,
      fork: `${this.env.GITHUB_BOT_LOGIN}/${config.fork}`,
      branch: context.branch,
      "env-json": JSON.stringify(config.environment),
      "runs-on": runsOn,
      "timeout-minutes": String(config.timeoutMinutes),
      "full-environment": String(fullEnvironmentModes.has(run.mode)),
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

  private attribution(config: RepoConfig): { repo: string; project: string } {
    return { repo: config.repo, project: config.project };
  }
}
