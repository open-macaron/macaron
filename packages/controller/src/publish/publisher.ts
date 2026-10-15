import { Injectable, Logger } from "@nestjs/common";
import type { RepoConfig, RunContext } from "@open-macaron/contracts";
import { describeError } from "../common/errors.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { repoRef, type RepoRef } from "../github/repo-ref.ts";
import type { RunRecord, ThreadRecord } from "../runs/runs.repository.ts";
import { RunsRepository } from "../runs/runs.repository.ts";
import { ForkCommitter } from "./fork-committer.ts";
import type { Publishable } from "./gate.ts";
import { type CostRow, renderCostTable, resolveAttachments, sanitize, upsertCostSection } from "./markdown.ts";
import { ReactionTargets } from "./reaction-targets.ts";
import { CannotPost, UpstreamWriter } from "./upstream-writer.ts";

export interface PublishInput {
  readonly run: RunRecord;
  readonly thread: ThreadRecord;
  readonly config: RepoConfig;
  readonly publishable: Publishable;
  readonly runUrl: string;
  /** attachment id → hosted URL (empty until evidence hosting ships). */
  readonly attachmentUrls: ReadonlyMap<string, string>;
}

export interface FailureInput {
  readonly run: RunRecord;
  readonly thread: ThreadRecord;
  readonly reason: string;
  readonly runUrl: string | null;
}

/**
 * Turns a gated run result into GitHub writes, each at most once (RunsRepository.once), in an
 * order that keeps the thread readable: commit → PR → threaded replies → message → status → cost.
 */
@Injectable()
export class Publisher {
  private readonly logger = new Logger(Publisher.name);

  constructor(
    private readonly runs: RunsRepository,
    private readonly committer: ForkCommitter,
    private readonly writer: UpstreamWriter,
    private readonly bot: BotIdentity,
    private readonly reactions: ReactionTargets,
  ) {}

  async publish(input: PublishInput): Promise<void> {
    const { run, config, publishable } = input;
    let thread = input.thread;
    const context = run.context;
    const upstream = repoRef(thread.repo);
    const mentions = participants(context);
    const clean = (body: string) => sanitize(resolveAttachments(body, input.attachmentUrls), mentions);
    const result = publishable.result;

    if (result.action === "commit" && publishable.changes !== undefined) {
      const fork: RepoRef = { owner: this.bot.identity.login, repo: config.fork };
      const changes = publishable.changes;
      await this.runs.once(thread.id, run.loop, "commit", async () => {
        const base = await this.writer.defaultBranch(upstream);
        await this.committer.ensureBranch(fork, context.branch, context.baseSha, base.name);
        return this.committer.commit(fork, context.branch, context.baseSha, changes, this.commitMessage(input), this.bot.identity);
      });
      if (thread.prNumber === null) {
        const prNumber = await this.runs.once(thread.id, run.loop, "pr", async () => {
          const base = await this.writer.defaultBranch(upstream);
          const title = result.pr?.title ?? result.summary.slice(0, 120);
          const reference = thread.kind === "issue" ? `\n\nRelated to #${String(thread.number)}.` : "";
          const body = `${clean(result.pr?.body ?? result.summary)}${reference}`;
          return this.writer.openPullRequest(upstream, `${fork.owner}:${context.branch}`, base.name, title, body, config.draftPr);
        });
        if (typeof prNumber === "number") {
          await this.runs.updateThread(thread.id, { prNumber, branch: context.branch });
          thread = { ...thread, prNumber, branch: context.branch };
        }
      }
    }

    // Threaded replies on review comments; issue comments can't be threaded, they go in the message.
    const reviewIds = new Set(context.reviewComments.map((comment) => comment.id));
    const quoted: string[] = [];
    for (const reply of result.replies) {
      if (reviewIds.has(reply.inReplyTo) && thread.prNumber !== null) {
        const prNumber = thread.prNumber;
        await this.post(() => this.runs.once(thread.id, run.loop, `reply:${String(reply.inReplyTo)}`, () => this.writer.replyToReviewComment(upstream, prNumber, reply.inReplyTo, clean(reply.body))));
      } else {
        const source = context.thread.find((comment) => comment.id === reply.inReplyTo);
        quoted.push(`> @${source?.author ?? "someone"} wrote:\n> ${(source?.body ?? "").split("\n").slice(0, 3).join("\n> ")}\n\n${reply.body}`);
      }
    }

    const message = [result.message, ...quoted].filter((part): part is string => part !== undefined && part.length > 0).join("\n\n---\n\n");
    if (message.length > 0) {
      const target = thread.prNumber ?? thread.number;
      await this.post(() => this.runs.once(thread.id, run.loop, "message", () => this.writer.comment(upstream, target, clean(message))));
    }

    await this.updateStatus(thread, run, `✅ ${clean(result.summary)}`, input.runUrl);
    await this.updateCostTable(thread);
    await this.reactions.finish(thread.id, run.loop, upstream, "+1");
  }

  /** The run failed or was refused: say so briefly in the status comment, react 😕. */
  async reportFailure(input: FailureInput): Promise<void> {
    const upstream = repoRef(input.thread.repo);
    await this.updateStatus(input.thread, input.run, `😕 ${input.reason}`, input.runUrl);
    await this.updateCostTable(input.thread);
    await this.reactions.finish(input.thread.id, input.run.loop, upstream, "confused");
  }

  /** No run happened (caps, pause, missing capability): explain in the status comment, react 😕. */
  async reportRefusal(thread: ThreadRecord, reason: string): Promise<void> {
    const upstream = repoRef(thread.repo);
    const body = `**macaron-bot** · not started\n\n😕 ${reason}`;
    await this.post(async () => {
      const id = await this.writer.upsertComment(upstream, thread.number, thread.statusCommentId, body);
      if (id !== thread.statusCommentId) await this.runs.updateThread(thread.id, { statusCommentId: id });
    });
    await this.reactions.finish(thread.id, thread.loops + 1, upstream, "confused");
  }

  private commitMessage(input: PublishInput): string {
    const { run, config, publishable } = input;
    const identity = this.bot.identity;
    const lines = [publishable.result.commitMessage ?? publishable.result.summary, "", `macaron-bot loop ${String(run.loop)} (${run.mode}): ${input.runUrl}`];
    if (config.contribution.dco) lines.push("", `Signed-off-by: ${identity.login} <${identity.email}>`);
    return lines.join("\n");
  }

  /** One sticky comment per thread, edited in place on every loop. */
  private async updateStatus(thread: ThreadRecord, run: RunRecord, outcome: string, runUrl: string | null): Promise<void> {
    const upstream = repoRef(thread.repo);
    const loops = await this.runs.loops(thread.id);
    const spent = loops.reduce((total, loop) => total + (loop.costMicros ?? 0), 0);
    const where = thread.prNumber !== null && thread.kind === "issue" ? `\n\nWork continues in #${String(thread.prNumber)}.` : "";
    const body = [
      `**macaron-bot** · loop ${String(run.loop)} · \`${run.mode}\`${runUrl === null ? "" : ` · [run](${runUrl})`}`,
      "",
      outcome,
      where,
      "",
      `<sub>Spent on this thread: $${(spent / 1_000_000).toFixed(2)}.</sub>`,
    ].join("\n");
    await this.post(async () => {
      const id = await this.writer.upsertComment(upstream, thread.number, thread.statusCommentId, body);
      if (id !== thread.statusCommentId) await this.runs.updateThread(thread.id, { statusCommentId: id });
    });
  }

  private async updateCostTable(thread: ThreadRecord): Promise<void> {
    if (thread.prNumber === null) return;
    const upstream = repoRef(thread.repo);
    const loops = await this.runs.loops(thread.id);
    const rows: CostRow[] = loops
      .filter((loop) => loop.costMicros !== null)
      .map((loop) => ({
        loop: loop.loop,
        trigger: `${loop.context.trigger.kind} by @${loop.context.trigger.author}`,
        mode: loop.mode,
        model: loop.model,
        costMicros: loop.costMicros ?? 0,
        runUrl: null,
      }));
    const prNumber = thread.prNumber;
    await this.post(async () => {
      const body = await this.writer.pullBody(upstream, prNumber);
      await this.writer.setPullBody(upstream, prNumber, upsertCostSection(body, renderCostTable(rows, 0, 0)));
    });
  }

  /** Locked threads and interaction limits are expected: log and move on, never retry. */
  private async post(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error: unknown) {
      if (!(error instanceof CannotPost)) throw error;
      this.logger.warn(`cannot post: ${describeError(error)}`);
    }
  }
}

/** Logins that may be @mentioned in what we post: the people already in the conversation. */
function participants(context: RunContext): Set<string> {
  return new Set([context.trigger.author, ...context.thread.map((comment) => comment.author), ...context.reviewComments.map((comment) => comment.author)]);
}
