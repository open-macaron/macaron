import { Inject, Injectable } from "@nestjs/common";
import {
  GitHubLogin,
  type Mode,
  type RepoConfig,
  type ReviewComment,
  RunContext,
  type ThreadComment,
} from "@open-macaron/contracts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { repoRef } from "../github/repo-ref.ts";
import { ForkCommitter } from "../publish/fork-committer.ts";
import { UpstreamWriter } from "../publish/upstream-writer.ts";
import { RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import { branchFor } from "./triggers.ts";

export interface Trigger {
  readonly kind: "mention" | "assign" | "review" | "comment";
  readonly author: string;
  readonly url: string;
  readonly instruction: string;
}

/** Media limits handed to the agent; the Gate enforces the same numbers. */
const ATTACHMENTS = { maxFiles: 10, maxFileBytes: 25_000_000, maxTotalBytes: 50_000_000 };
const MAX_COMMENTS = 100;

/**
 * Builds `context.json`: exactly what the agent is told. Everything comes from GitHub at launch
 * time; the base commit is the fork branch head for follow-up loops, the upstream default
 * branch head otherwise.
 */
@Injectable()
export class ContextBuilder {
  constructor(
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    private readonly runs: RunsRepository,
    private readonly committer: ForkCommitter,
    private readonly writer: UpstreamWriter,
    private readonly bot: BotIdentity,
  ) {}

  async build(config: RepoConfig, thread: ThreadRecord, mode: Mode, trigger: Trigger): Promise<RunContext> {
    const upstream = repoRef(thread.repo);
    const { data: issue } = await this.gh.rest.issues.get({ ...upstream, issue_number: thread.number });
    const branch = thread.branch ?? branchFor(thread.number, issue.title);

    const fork = { owner: this.bot.identity.login, repo: config.fork };
    const branchHead = thread.branch === null ? undefined : await this.committer.head(fork, thread.branch);
    const baseSha = branchHead ?? (await this.writer.defaultBranch(upstream)).sha;

    // The issue body comes first, under the issue number as its id (comment ids are far larger).
    const conversation: ThreadComment[] = [];
    if ((issue.body ?? "").length > 0) {
      conversation.push({ id: thread.number, author: loginOf(issue.user?.login ?? "ghost"), body: issue.body ?? "", createdAt: issue.created_at });
    }
    conversation.push(...(await this.comments(upstream, thread.number)));
    if (thread.prNumber !== null && thread.prNumber !== thread.number) conversation.push(...(await this.comments(upstream, thread.prNumber)));
    if (thread.prNumber !== null) conversation.push(...(await this.reviews(upstream, thread.prNumber)));
    conversation.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const reviewComments = thread.prNumber === null ? [] : await this.reviewComments(upstream, thread.prNumber);
    const priorLoops = (await this.runs.loops(thread.id))
      .filter((run) => run.finishedAt !== null)
      .map((run) => ({ loop: run.loop, mode: run.mode, summary: run.failure ?? `${run.mode} loop`, costUsd: (run.costMicros ?? 0) / 1_000_000 }));

    return RunContext.parse({
      mode,
      repo: thread.repo,
      number: thread.number,
      kind: thread.kind,
      title: issue.title,
      baseSha,
      branch,
      trigger,
      thread: conversation.slice(-MAX_COMMENTS),
      reviewComments: reviewComments.slice(-MAX_COMMENTS),
      priorLoops,
      commands: config.commands,
      attachments: ATTACHMENTS,
    });
  }

  private async comments(upstream: { owner: string; repo: string }, number: number): Promise<ThreadComment[]> {
    const all = await this.gh.paginate(this.gh.rest.issues.listComments, { ...upstream, issue_number: number, per_page: 100 });
    return all.map((comment) => ({ id: comment.id, author: loginOf(comment.user?.login ?? "ghost"), body: comment.body ?? "", createdAt: comment.created_at }));
  }

  /** Review summaries; their inline comments come separately (reviewComments). */
  private async reviews(upstream: { owner: string; repo: string }, pull: number): Promise<ThreadComment[]> {
    const all = await this.gh.paginate(this.gh.rest.pulls.listReviews, { ...upstream, pull_number: pull, per_page: 100 });
    return all.flatMap((review) =>
      review.body.trim().length === 0 || review.submitted_at === undefined
        ? []
        : [{ id: review.id, author: loginOf(review.user?.login ?? "ghost"), body: review.body, createdAt: review.submitted_at }],
    );
  }

  private async reviewComments(upstream: { owner: string; repo: string }, pull: number): Promise<ReviewComment[]> {
    const all = await this.gh.paginate(this.gh.rest.pulls.listReviewComments, { ...upstream, pull_number: pull, per_page: 100 });
    return all.map((comment) => ({
      id: comment.id,
      author: loginOf(comment.user.login),
      body: comment.body,
      path: comment.path,
      line: comment.line ?? null,
      inReplyTo: comment.in_reply_to_id ?? null,
      createdAt: comment.created_at,
    }));
  }
}

function loginOf(login: string): GitHubLogin {
  return GitHubLogin.parse(login);
}
