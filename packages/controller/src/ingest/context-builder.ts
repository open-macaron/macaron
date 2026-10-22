import { Inject, Injectable, Logger } from "@nestjs/common";
import { UpstreamError } from "../common/errors.ts";
import {
  GitHubLogin,
  platformsOf,
  type RepoConfig,
  type ReviewComment,
  type ReviewContext,
  RunContext,
  type RunKnowledge,
  type ThreadComment,
} from "@open-macaron/contracts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { repoRef } from "../github/repo-ref.ts";
import { ForkCommitter } from "../publish/fork-committer.ts";
import { UpstreamWriter } from "../publish/upstream-writer.ts";
import { KnowledgeClient } from "../review/knowledge-client.ts";
import { PullDiffReader } from "../review/pull-diff.ts";
import { selectRules } from "@open-macaron/review";
import { RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import { platformOf, type Route } from "../routing/routes.ts";

export interface Trigger {
  readonly kind: "mention" | "assign" | "review" | "comment";
  readonly author: string;
  readonly url: string;
  readonly instruction: string;
}

/** Media limits handed to the agent; the Gate enforces the same numbers. */
const ATTACHMENTS = { maxFiles: 20, maxFileBytes: 25_000_000, maxTotalBytes: 50_000_000 };
const MAX_COMMENTS = 100;
/** RunKnowledge's limit: beyond it, skill descriptions alone would crowd the context. */
const MAX_LESSONS = 200;

/**
 * Builds `context.json`: exactly what the agent is told. Everything comes from GitHub at launch
 * time; the base commit and branch come from the run's route.
 */
@Injectable()
export class ContextBuilder {
  private readonly logger = new Logger(ContextBuilder.name);

  constructor(
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    private readonly runs: RunsRepository,
    private readonly committer: ForkCommitter,
    private readonly writer: UpstreamWriter,
    private readonly bot: BotIdentity,
    private readonly diffs: PullDiffReader,
    private readonly knowledge: KnowledgeClient,
  ) {}

  async build(config: RepoConfig, thread: ThreadRecord, route: Route, trigger: Trigger): Promise<RunContext> {
    const upstream = repoRef(thread.repo);
    const { data: issue } = await this.gh.rest.issues.get({ ...upstream, issue_number: thread.number });
    const { mode, branch, checkout } = route;
    const review = mode === "review" && checkout.from === "pullRequestHead" ? await this.reviewContext(config, checkout.pullRequest) : undefined;
    const baseSha = review?.headSha ?? (await this.resolve(config, route));

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
      review,
      platform: platformOf(route),
      platforms: platformsOf(config),
      knowledge: review === undefined ? await this.lessons(config) : { commit: null, lessons: [] },
    });
  }

  /**
   * The repository's lessons for a working run, at the knowledge commit they were read at. They help,
   * they don't gate: a run starts without them when the knowledge site can't be read.
   */
  private async lessons(config: RepoConfig): Promise<RunKnowledge> {
    try {
      const { commit, lessons } = await this.knowledge.knowledgeFor(config);
      return { commit, lessons: lessons.slice(0, MAX_LESSONS) };
    } catch (error: unknown) {
      if (!(error instanceof UpstreamError)) throw error;
      this.logger.warn(`${config.repo}: running without lessons: ${error.message}`);
      return { commit: null, lessons: [] };
    }
  }

  /** The commit the route's checkout points at now. */
  private async resolve(config: RepoConfig, route: Route): Promise<string> {
    const upstream = repoRef(config.repo);
    switch (route.checkout.from) {
      case "defaultBranch":
        return (await this.writer.defaultBranch(upstream)).sha;
      case "botBranch": {
        // A branch deleted since (by hand) falls back to the default branch: nothing to continue from.
        const head = await this.committer.head({ owner: this.bot.identity.login, repo: config.fork }, route.branch);
        return head ?? (await this.writer.defaultBranch(upstream)).sha;
      }
      case "pullRequestHead":
        return (await this.diffs.head(config.repo, route.checkout.pullRequest)).headSha;
    }
  }

  /** The pull request at its current head, and the knowledge rules its changed files call for. */
  private async reviewContext(config: RepoConfig, pull: number): Promise<ReviewContext> {
    const { baseSha, headSha } = await this.diffs.head(config.repo, pull);
    const [diff, knowledge] = await Promise.all([this.diffs.read(config.repo, baseSha, headSha), this.knowledge.rulesFor(config)]);
    const paths = diff.files.map((file) => file.path);
    return { pull, baseSha, headSha, ...selectRules(knowledge.rules, paths), knowledgeCommit: knowledge.commit };
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
