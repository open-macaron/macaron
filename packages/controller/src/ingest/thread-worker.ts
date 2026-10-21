import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { type Mode, type Platform, type RepoConfig, runnerFor } from "@open-macaron/contracts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { Jobs, Queue, RunCompletedJob, ThreadReadyJob } from "../jobs/jobs.ts";
import { repoRef } from "../github/repo-ref.ts";
import { Publisher } from "../publish/publisher.ts";
import { ReactionTargets, reactionTargetOf } from "../publish/reaction-targets.ts";
import { isRefusal, platformOf, platformOfRun, type Route, route, type Subject, subjectOf, subjectOfRun, type ThreadState } from "../routing/routes.ts";
import { ThreadStates } from "../routing/thread-states.ts";
import { type Escalation, type LaunchOutcome, RunLauncher } from "../runs/run-launcher.ts";
import { ACTIVE_STATUSES, RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import { ContextBuilder, type Trigger } from "./context-builder.ts";
import { type EventRecord, EventsRepository, QUIET_PERIOD_MS } from "./events.repository.ts";
import { decideMode, parseMention } from "./triggers.ts";

/** How long a thread waits when every runner slot is taken. */
const BUSY_RETRY_MS = 120_000;

/** A request to route: a mode, asked on a subject, by a trigger, for a platform. */
interface Request {
  readonly subject: Subject;
  readonly mode: Mode;
  readonly trigger: Trigger;
  readonly platform: Platform;
}

/**
 * Processes a thread once it has been quiet. Requests on the issue and on a pull request are
 * separate: the worker takes the subject of the oldest pending request, decides the mode from that
 * subject's requests, routes it (ROUTES) and launches the run or posts the refusal there. The
 * other subject waits for the next pass: one run at a time per thread. Also completes finished
 * runs, launching the escalation a run may ask for.
 */
@Injectable()
export class ThreadWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(ThreadWorker.name);

  constructor(
    private readonly jobs: Jobs,
    private readonly events: EventsRepository,
    private readonly runs: RunsRepository,
    private readonly config: RepoConfigService,
    private readonly states: ThreadStates,
    private readonly contexts: ContextBuilder,
    private readonly launcher: RunLauncher,
    private readonly publisher: Publisher,
    private readonly reactions: ReactionTargets,
    private readonly bot: BotIdentity,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(Queue.threadReady, ThreadReadyJob, ({ threadId }) => this.process(threadId));
    await this.jobs.work(Queue.runCompleted, RunCompletedJob, async ({ ghRunId, conclusion }) => {
      const escalation = await this.launcher.complete(ghRunId, conclusion);
      if (escalation !== undefined) await this.escalate(escalation);
    });
  }

  async process(threadId: string): Promise<void> {
    const pending = await this.events.pending(threadId);
    const first = pending[0];
    if (first === undefined) return;
    const thread = await this.runs.threadById(threadId);
    const config = this.config.repo(thread.repo);
    if (config === undefined) return this.events.settle(pending.map((event) => event.id), "dropped");

    // One run at a time per thread: the requests wait for the current run to finish.
    const loops = await this.runs.loops(thread.id);
    if (loops.some((run) => ACTIVE_STATUSES.includes(run.status))) return this.jobs.threadReady(thread.id, QUIET_PERIOD_MS);

    // The oldest request's subject goes first; requests on another subject wait for the next pass.
    const batch = pending.filter((event) => event.subjectKind === first.subjectKind && event.subjectNumber === first.subjectNumber);
    try {
      await this.processBatch(config, thread, batch, loops);
    } finally {
      if (pending.length > batch.length) await this.jobs.threadReady(thread.id, QUIET_PERIOD_MS);
    }
  }

  async escalate({ thread, from, mode, platform }: Escalation): Promise<void> {
    const config = this.config.repo(thread.repo);
    if (config === undefined) return;
    const request: Request = { subject: subjectOfRun(from, thread), mode, trigger: from.context.trigger, platform: platform ?? platformOfRun(from) };
    const outcome = await this.routeAndStart(config, thread, await this.states.read(config.repo, thread), request);
    if (outcome.kind === "refused") await this.publisher.reportRefusal(thread, request.subject, outcome.reason);
    if (outcome.kind === "queued") this.logger.warn(`escalation of ${thread.repo}#${String(thread.number)} to ${mode} dropped: ${outcome.reason}`);
  }

  /** One subject's pending requests: routed, then launched or refused. */
  private async processBatch(config: RepoConfig, thread: ThreadRecord, batch: readonly EventRecord[], loops: Awaited<ReturnType<RunsRepository["loops"]>>): Promise<void> {
    const ids = batch.map((event) => event.id);
    const last = batch.at(-1);
    if (last === undefined) return;
    const upstream = repoRef(thread.repo);
    // Whatever happens next answers these requests: their 👀 belong to the next loop.
    await this.reactions.claim(thread.id, batch.map(reactionTargetOf), thread.loops + 1);

    // Two bots must not ping-pong forever.
    const fromBotsOnly = batch.every((event) => this.config.trigger(thread.repo, event.author) === "bot");
    if (fromBotsOnly && thread.loops >= config.caps.botReviewLoops) {
      this.logger.log(`${thread.repo}#${String(thread.number)}: bot review loop cap reached, ignoring`);
      return this.events.settle(ids, "dropped");
    }

    const login = this.bot.identity.login;
    const mentions = batch.map((event) => parseMention(event.body, login));
    const command = decideMode(batch.map((event, index) => ({ kind: eventKind(event), command: mentions[index]?.command })));
    // The platform comes with the command that won: the latest explicit one.
    const platform = mentions.filter((mention) => mention?.command !== undefined).at(-1)?.platform;
    if (command === undefined || command === "stop") return this.events.settle(ids, "done");

    const state = await this.states.read(config.repo, thread);
    const subject = subjectOf({ kind: last.subjectKind, number: last.subjectNumber }, state);
    let request: Request;
    if (command === "retry") {
      const previous = loops.at(-1);
      if (previous === undefined || previous.status === "completed") {
        await this.events.settle(ids, "dropped");
        return this.publisher.reportRefusal(thread, subject, "there is no failed loop to retry");
      }
      await this.reactions.adopt(thread.id, previous.loop, thread.loops + 1, upstream);
      request = { subject: subjectOfRun(previous, thread), mode: previous.mode, trigger: previous.context.trigger, platform: platform ?? platformOfRun(previous) };
    } else {
      const trigger: Trigger = {
        kind: eventKind(last),
        author: last.author,
        url: last.url,
        instruction: (parseMention(last.body, login)?.instruction ?? last.body).slice(0, 4_096),
      };
      request = { subject, mode: command, trigger, platform: platform ?? "linux" };
    }

    const outcome = await this.routeAndStart(config, thread, state, request);
    switch (outcome.kind) {
      case "launched":
        return this.events.settle(ids, "done");
      case "queued":
        return this.jobs.threadReady(thread.id, BUSY_RETRY_MS);
      case "refused":
        await this.events.settle(ids, "dropped");
        return this.publisher.reportRefusal(thread, request.subject, outcome.reason);
    }
  }

  /** Routes a request (ROUTES), then launches the run unless the route or the repository refuses it. */
  private async routeAndStart(config: RepoConfig, thread: ThreadRecord, state: ThreadState, request: Request): Promise<LaunchOutcome> {
    const routed = route(state, request.subject, request.mode, request.platform);
    if (isRefusal(routed)) return { kind: "refused", reason: routed.refused };
    return this.start(config, thread, routed, request.trigger);
  }

  private async start(config: RepoConfig, thread: ThreadRecord, routed: Route, trigger: Trigger): Promise<LaunchOutcome> {
    const platform = platformOf(routed);
    if (runnerFor(config, platform) === undefined) return { kind: "refused", reason: `\`${platform}\` isn't enabled for this repository` };
    const context = await this.contexts.build(config, thread, routed, trigger);
    // Nothing to check: no runner, no cost.
    if (context.review?.rules.length === 0) {
      return { kind: "refused", reason: "no rule from open-macaron/knowledge applies to the files this pull request changes" };
    }
    return this.launcher.launch({ config, thread, route: routed, context });
  }
}

function eventKind(event: EventRecord): "mention" | "review" | "comment" {
  return event.kind === "review" || event.kind === "comment" ? event.kind : "mention";
}
