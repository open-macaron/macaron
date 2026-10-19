import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RepoConfig, RunContext } from "@open-macaron/contracts";
import { z } from "zod";
import { describeError } from "../common/errors.ts";
import { formatUsd, type UsdMicros } from "../common/money.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { repoRef, type RepoRef } from "../github/repo-ref.ts";
import type { RunRecord, ThreadRecord } from "../runs/runs.repository.ts";
import { RunsRepository } from "../runs/runs.repository.ts";
import { runUrl } from "../runs/run-url.ts";
import { renderReview, withReviewCost } from "../review/render.ts";
import type { RuleResult } from "@open-macaron/review";
import { Route, type Subject, subjectOfRun } from "../routing/routes.ts";
import { EvidenceHost } from "./evidence-host.ts";
import { ForkCommitter } from "./fork-committer.ts";
import type { Publishable } from "./gate.ts";
import { type CostRow, type LoopState, renderCostTable, resolveAttachments, sanitize, upsertCostSection } from "./markdown.ts";
import { ReactionTargets } from "./reaction-targets.ts";
import { type StatusComment, statusComment } from "./status-comment.ts";
import { CannotPost, UpstreamWriter } from "./upstream-writer.ts";

export interface PublishInput {
  readonly run: RunRecord;
  readonly thread: ThreadRecord;
  readonly config: RepoConfig;
  readonly publishable: Publishable;
  readonly runUrl: string;
}

/** The review id stored as the `review` effect's external id. */
const ReviewId = z.coerce.number().int().positive();


function loopState(status: RunRecord["status"]): LoopState {
  switch (status) {
    case "pending":
    case "dispatched":
    case "running":
      return "running";
    case "completed":
    case "failed":
    case "aborted":
      return status;
  }
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
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly runs: RunsRepository,
    private readonly committer: ForkCommitter,
    private readonly writer: UpstreamWriter,
    private readonly bot: BotIdentity,
    private readonly reactions: ReactionTargets,
    private readonly evidence: EvidenceHost,
  ) {}

  async publish(input: PublishInput): Promise<void> {
    if (input.publishable.review !== undefined) return this.publishReview(input, input.publishable.review);
    const { run, config, publishable } = input;
    let thread = input.thread;
    // Everything answers where the request was made (the run's subject).
    const subject = subjectOfRun(run, thread);
    const status = statusComment(thread, subject);
    const supersedes = run.route === null ? undefined : Route.parse(run.route).supersedes;
    const context = run.context;
    const upstream = repoRef(thread.repo);
    const mentions = participants(context);
    // Media first: the texts below reference them by URL (posting those texts makes them public).
    const attachmentUrls = await this.evidence.publish({ owner: this.bot.identity.login, repo: config.fork }, thread, run, publishable.attachments);
    const clean = (body: string) => sanitize(resolveAttachments(body, attachmentUrls), mentions);
    const result = publishable.result;

    if (result.action === "commit" && publishable.changes !== undefined) {
      const fork: RepoRef = { owner: this.bot.identity.login, repo: config.fork };
      const changes = publishable.changes;
      await this.runs.once(thread.id, run.loop, "commit", async () => {
        const base = await this.writer.defaultBranch(upstream);
        await this.committer.ensureBranch(fork, context.branch, context.baseSha, base.name);
        return this.committer.commit(fork, context.branch, context.baseSha, changes, this.commitMessage(input), this.bot.identity);
      });
      // A fresh attempt opens its own pull request, then closes the one it supersedes.
      if (thread.prNumber === null || supersedes !== undefined) {
        const prNumber = await this.runs.once(thread.id, run.loop, "pr", async () => {
          const base = await this.writer.defaultBranch(upstream);
          const title = result.pr?.title ?? result.summary.slice(0, 120);
          const text = clean(result.pr?.body ?? result.summary);
          // Link the issue unless the agent already did (e.g. "Closes #12").
          const mentionsIssue = new RegExp(`#${String(thread.number)}\\b`).test(text);
          const reference = thread.kind === "issue" && !mentionsIssue ? `\n\nRelated to #${String(thread.number)}.` : "";
          const body = `${text}${reference}`;
          return this.writer.openPullRequest(upstream, `${fork.owner}:${context.branch}`, base.name, title, body, config.draftPr);
        });
        if (typeof prNumber === "number") {
          await this.runs.updateThread(thread.id, { prNumber, branch: context.branch, prStatusCommentId: null });
          thread = { ...thread, prNumber, branch: context.branch, prStatusCommentId: null };
          if (supersedes !== undefined) {
            await this.post(() => this.runs.once(thread.id, run.loop, "supersede", () => this.writer.closePullRequest(upstream, supersedes, `Superseded by #${String(prNumber)}.`).then(() => supersedes)));
          }
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
      await this.post(() => this.runs.once(thread.id, run.loop, "message", () => this.writer.comment(upstream, subject.number, clean(message))));
    }

    await this.updateStatus(thread, status, run, `✅ ${clean(result.summary)}`, input.runUrl);
    await this.updateCostTable(thread);
    await this.reactions.finish(thread.id, run.loop, upstream, "+1");
  }

  /** The run failed or was refused: say so briefly in the status comment, react 😕. */
  async reportFailure(input: FailureInput): Promise<void> {
    const upstream = repoRef(input.thread.repo);
    const retry = `Comment \`@${this.bot.identity.login} retry\` to run this loop again.`;
    await this.updateStatus(input.thread, statusComment(input.thread, subjectOfRun(input.run, input.thread)), input.run, `😕 ${input.reason}\n\n${retry}`, input.runUrl);
    await this.updateCostTable(input.thread);
    await this.reactions.finish(input.thread.id, input.run.loop, upstream, "confused");
  }

  /** A run was dispatched: the status comment and the PR's table show it, with its link, right away. */
  async reportStarted(thread: ThreadRecord, run: RunRecord, runUrl: string | null): Promise<void> {
    await this.updateStatus(thread, statusComment(thread, subjectOfRun(run, thread)), run, "⏳ Working on it.", runUrl);
    await this.updateCostTable(thread);
  }

  /** Called when a loop's cost is settled: the PR's cost table picks up the final number. */
  async refreshCost(thread: ThreadRecord): Promise<void> {
    await this.updateCostTable(thread);
  }

  /** A review run's cost is settled: its review shows the amount instead of ⏳. */
  async refreshReviewCost(thread: ThreadRecord, run: RunRecord, costMicros: UsdMicros): Promise<void> {
    const review = run.context.review;
    const reviewId = ReviewId.safeParse(await this.runs.effect(thread.id, run.loop, "review"));
    if (review === undefined || !reviewId.success) return;
    const upstream = repoRef(thread.repo);
    const body = await this.writer.reviewBody(upstream, review.pull, reviewId.data);
    const updated = withReviewCost(body, costMicros);
    if (updated !== undefined && updated !== body) await this.post(() => this.writer.updateReview(upstream, review.pull, reviewId.data, updated));
  }

  /**
   * A review run: one GitHub review (table + inline comments) on the commit that was checked, once.
   * If GitHub refuses an inline comment (a line outside its diff view), the review is posted
   * without them: the table carries the same evidence.
   */
  private async publishReview(input: PublishInput, results: readonly RuleResult[]): Promise<void> {
    const { run, thread } = input;
    const review = run.context.review;
    if (review === undefined) throw new Error(`run ${run.id} has review results but no review context`);
    const upstream = repoRef(thread.repo);
    const { body, comments } = renderReview(results, {
      repo: thread.repo,
      headSha: review.headSha,
      knowledgeCommit: review.knowledgeCommit,
      runUrl: input.runUrl,
      costMicros: null,
    });
    await this.post(() =>
      this.runs.once(thread.id, run.loop, "review", async () => {
        try {
          return await this.writer.createReview(upstream, review.pull, review.headSha, body, comments);
        } catch (error: unknown) {
          if (!(error instanceof CannotPost) || error.status !== 422 || comments.length === 0) throw error;
          this.logger.warn(`review on ${thread.repo}#${String(review.pull)}: inline comments refused, posting the table alone`);
          return this.writer.createReview(upstream, review.pull, review.headSha, body, []);
        }
      }),
    );
    const count = (outcome: RuleResult["outcome"]) => String(results.filter((result) => result.outcome === outcome).length);
    await this.updateStatus(thread, statusComment(thread, subjectOfRun(run, thread)), run, `✅ Review posted: ❌ ${count("violation")} · ⚠️ ${count("warning")} · ✅ ${count("valid")} · ➖ ${count("ignored")}.`, input.runUrl);
    await this.updateCostTable(thread);
    await this.reactions.finish(thread.id, run.loop, upstream, "+1");
  }

  /** No run happened (a route, caps, pause, missing capability): explain where it was asked, react 😕. */
  async reportRefusal(thread: ThreadRecord, subject: Subject, reason: string): Promise<void> {
    const upstream = repoRef(thread.repo);
    await this.upsertStatus(thread, statusComment(thread, subject), `**macaron-bot** · not started\n\n😕 ${reason}`);
    await this.reactions.finish(thread.id, thread.loops + 1, upstream, "confused");
  }

  private commitMessage(input: PublishInput): string {
    const { run, config, publishable } = input;
    const identity = this.bot.identity;
    const lines = [publishable.result.commitMessage ?? publishable.result.summary, "", `macaron-bot loop ${String(run.loop)} (${run.mode}): ${input.runUrl}`];
    if (config.contribution.dco) lines.push("", `Signed-off-by: ${identity.login} <${identity.email}>`);
    return lines.join("\n");
  }

  /** One sticky comment per subject, edited in place on every loop. */
  private async updateStatus(thread: ThreadRecord, target: StatusComment, run: RunRecord, outcome: string, runUrl: string | null): Promise<void> {
    const loops = await this.runs.loops(thread.id);
    const spent = loops.reduce((total, loop) => total + (loop.costMicros ?? 0), 0);
    const pending = loops.some((loop) => loop.settledAt === null) ? " ⏳" : "";
    const where = target.column === "statusCommentId" && thread.prNumber !== null && thread.kind === "issue" ? `\n\nWork continues in #${String(thread.prNumber)}.` : "";
    const body = [
      `**macaron-bot** · loop ${String(run.loop)} · \`${run.mode}\`${runUrl === null ? "" : ` · [run](${runUrl})`}`,
      "",
      outcome,
      where,
      "",
      `<sub>Spent on this thread: ${formatUsd(spent)}${pending}.</sub>`,
    ].join("\n");
    await this.upsertStatus(thread, target, body);
  }

  private async upsertStatus(thread: ThreadRecord, target: StatusComment, body: string): Promise<void> {
    await this.post(async () => {
      const id = await this.writer.upsertComment(repoRef(thread.repo), target.number, target.commentId, body);
      if (id === target.commentId || target.column === undefined) return;
      await this.runs.updateThread(thread.id, target.column === "prStatusCommentId" ? { prStatusCommentId: id } : { statusCommentId: id });
    });
  }

  private async updateCostTable(thread: ThreadRecord): Promise<void> {
    if (thread.prNumber === null) return;
    const upstream = repoRef(thread.repo);
    const loops = await this.runs.loops(thread.id);
    const rows: CostRow[] = loops.map((loop) => ({
      loop: loop.loop,
      state: loopState(loop.status),
      trigger: `${loop.context.trigger.kind} by @${loop.context.trigger.author}`,
      mode: loop.mode,
      model: loop.model,
      costMicros: loop.costMicros,
      runUrl: runUrl(this.env, loop.ghRunId),
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
