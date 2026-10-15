import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Mode, RepoConfig } from "@open-macaron/contracts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { Jobs, Queue, RunCompletedJob, ThreadReadyJob } from "../jobs/jobs.ts";
import { Publisher } from "../publish/publisher.ts";
import { type Escalation, type LaunchOutcome, RunLauncher } from "../runs/run-launcher.ts";
import { ACTIVE_STATUSES, RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import { ContextBuilder, type Trigger } from "./context-builder.ts";
import { type EventRecord, EventsRepository, QUIET_PERIOD_MS } from "./events.repository.ts";
import { decideMode, parseMention } from "./triggers.ts";

/** How long a thread waits when every runner slot is taken. */
const BUSY_RETRY_MS = 120_000;
const NEEDS_GUI: ReadonlySet<Mode> = new Set<Mode>(["reproduce", "verify"]);

/**
 * Processes a thread once it has been quiet: decides the mode from its pending triggers, builds
 * the agent's context and launches the run. Also completes finished runs, launching the
 * escalation a run may ask for.
 */
@Injectable()
export class ThreadWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(ThreadWorker.name);

  constructor(
    private readonly jobs: Jobs,
    private readonly events: EventsRepository,
    private readonly runs: RunsRepository,
    private readonly config: RepoConfigService,
    private readonly contexts: ContextBuilder,
    private readonly launcher: RunLauncher,
    private readonly publisher: Publisher,
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
    if (pending.length === 0) return;
    const thread = await this.runs.threadById(threadId);
    const config = this.config.repo(thread.repo);
    const ids = pending.map((event) => event.id);
    if (config === undefined) return this.events.settle(ids, "dropped");

    // One run at a time per thread: the batch waits for the current run to finish.
    const loops = await this.runs.loops(thread.id);
    if (loops.some((run) => ACTIVE_STATUSES.includes(run.status))) return this.jobs.threadReady(thread.id, QUIET_PERIOD_MS);

    // Two bots must not ping-pong forever.
    const fromBotsOnly = pending.every((event) => this.config.trigger(thread.repo, event.author) === "bot");
    if (fromBotsOnly && thread.loops >= config.caps.botReviewLoops) {
      this.logger.log(`${thread.repo}#${String(thread.number)}: bot review loop cap reached, ignoring`);
      return this.events.settle(ids, "dropped");
    }

    const login = this.bot.identity.login;
    const mode = decideMode(pending.map((event) => ({ kind: eventKind(event), command: parseMention(event.body, login)?.command })));
    if (mode === undefined || mode === "stop") return this.events.settle(ids, "done");

    let request: { readonly mode: Mode; readonly trigger: Trigger };
    if (mode === "retry") {
      const previous = loops.at(-1);
      if (previous === undefined || previous.status === "completed") {
        await this.events.settle(ids, "dropped");
        return this.publisher.reportRefusal(thread, "there is no failed loop to retry");
      }
      request = { mode: previous.mode, trigger: previous.context.trigger };
    } else {
      const last = pending.at(-1);
      if (last === undefined) return;
      request = {
        mode,
        trigger: {
          kind: eventKind(last),
          author: last.author,
          url: last.url,
          instruction: (parseMention(last.body, login)?.instruction ?? last.body).slice(0, 4_096),
        },
      };
    }
    const outcome = await this.start(config, thread, request.mode, request.trigger);
    switch (outcome.kind) {
      case "launched":
        return this.events.settle(ids, "done");
      case "queued":
        return this.jobs.threadReady(thread.id, BUSY_RETRY_MS);
      case "refused":
        await this.events.settle(ids, "dropped");
        return this.publisher.reportRefusal(thread, outcome.reason);
    }
  }

  async escalate({ thread, from, mode }: Escalation): Promise<void> {
    const config = this.config.repo(thread.repo);
    if (config === undefined) return;
    const outcome = await this.start(config, thread, mode, from.context.trigger);
    if (outcome.kind === "refused") await this.publisher.reportRefusal(thread, outcome.reason);
    if (outcome.kind === "queued") this.logger.warn(`escalation of ${thread.repo}#${String(thread.number)} to ${mode} dropped: ${outcome.reason}`);
  }

  private async start(config: RepoConfig, thread: ThreadRecord, mode: Mode, trigger: Trigger): Promise<LaunchOutcome> {
    if (NEEDS_GUI.has(mode) && !config.capabilities.includes("gui")) {
      return { kind: "refused", reason: `this repository's environment can't run the application yet, so \`${mode}\` isn't available` };
    }
    const context = await this.contexts.build(config, thread, mode, trigger);
    return this.launcher.launch({ config, thread, mode, context });
  }
}

function eventKind(event: EventRecord): "mention" | "review" | "comment" {
  return event.kind === "review" || event.kind === "comment" ? event.kind : "mention";
}
