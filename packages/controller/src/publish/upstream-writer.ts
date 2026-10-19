import { Inject, Injectable } from "@nestjs/common";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { httpStatus, type RepoRef } from "../github/repo-ref.ts";

export type ReactionContent = "eyes" | "+1" | "confused" | "rocket";
export type ReactionTarget =
  | { readonly kind: "issue"; readonly number: number }
  | { readonly kind: "issue-comment"; readonly id: number }
  | { readonly kind: "review-comment"; readonly id: number };

/** Thrown when the upstream refuses our comment (locked conversation, interaction limits). */
export class CannotPost extends Error {
  constructor(readonly status: number) {
    super(`upstream refused the post (HTTP ${String(status)})`);
    this.name = "CannotPost";
  }
}

/**
 * Everything the bot writes on upstream repositories, as an outside contributor, with
 * GH_INTERACT. Never pushes code (that is ForkCommitter's job, with another token).
 */
@Injectable()
export class UpstreamWriter {
  constructor(@Inject(GH_INTERACT) private readonly gh: GitHub) {}

  async defaultBranch(upstream: RepoRef): Promise<{ readonly name: string; readonly sha: string }> {
    const { data: repo } = await this.gh.rest.repos.get({ ...upstream });
    const { data: ref } = await this.gh.rest.git.getRef({ ...upstream, ref: `heads/${repo.default_branch}` });
    return { name: repo.default_branch, sha: ref.object.sha };
  }

  async openPullRequest(upstream: RepoRef, head: string, base: string, title: string, body: string, draft: boolean): Promise<number> {
    const { data } = await this.posting(() =>
      this.gh.rest.pulls.create({ ...upstream, head, base, title, body, draft, maintainer_can_modify: true }),
    );
    return data.number;
  }

  /** Closes one of the bot's own pull requests (its author may), saying why first. */
  async closePullRequest(upstream: RepoRef, number: number, reason: string): Promise<void> {
    await this.comment(upstream, number, reason);
    await this.posting(() => this.gh.rest.pulls.update({ ...upstream, pull_number: number, state: "closed" }));
  }

  async pullBody(upstream: RepoRef, number: number): Promise<string> {
    const { data } = await this.gh.rest.pulls.get({ ...upstream, pull_number: number });
    return data.body ?? "";
  }

  async setPullBody(upstream: RepoRef, number: number, body: string): Promise<void> {
    await this.gh.rest.pulls.update({ ...upstream, pull_number: number, body });
  }

  async replyToReviewComment(upstream: RepoRef, pull: number, commentId: number, body: string): Promise<number> {
    const { data } = await this.posting(() =>
      this.gh.rest.pulls.createReplyForReviewComment({ ...upstream, pull_number: pull, comment_id: commentId, body }),
    );
    return data.id;
  }

  /** One review (event COMMENT) with its inline comments, on an exact commit. Never approves or requests changes. */
  async createReview(
    upstream: RepoRef,
    pull: number,
    commitId: string,
    body: string,
    comments: readonly { readonly path: string; readonly line: number; readonly side: "RIGHT"; readonly body: string }[],
  ): Promise<number> {
    const { data } = await this.posting(() =>
      this.gh.rest.pulls.createReview({ ...upstream, pull_number: pull, commit_id: commitId, event: "COMMENT", body, comments: comments.map((comment) => ({ ...comment })) }),
    );
    return data.id;
  }

  async reviewBody(upstream: RepoRef, pull: number, reviewId: number): Promise<string> {
    const { data } = await this.gh.rest.pulls.getReview({ ...upstream, pull_number: pull, review_id: reviewId });
    return data.body;
  }

  async updateReview(upstream: RepoRef, pull: number, reviewId: number, body: string): Promise<void> {
    await this.posting(() => this.gh.rest.pulls.updateReview({ ...upstream, pull_number: pull, review_id: reviewId, body }));
  }

  async comment(upstream: RepoRef, number: number, body: string): Promise<number> {
    const { data } = await this.posting(() => this.gh.rest.issues.createComment({ ...upstream, issue_number: number, body }));
    return data.id;
  }

  /** Edits our sticky status comment, or creates it. Returns its id. */
  async upsertComment(upstream: RepoRef, number: number, existingId: number | null, body: string): Promise<number> {
    if (existingId !== null) {
      try {
        await this.gh.rest.issues.updateComment({ ...upstream, comment_id: existingId, body });
        return existingId;
      } catch (error: unknown) {
        if (httpStatus(error) !== 404) throw error; // deleted by a maintainer: post a new one
      }
    }
    return this.comment(upstream, number, body);
  }

  async react(upstream: RepoRef, target: ReactionTarget, content: ReactionContent): Promise<number> {
    switch (target.kind) {
      case "issue":
        return (await this.gh.rest.reactions.createForIssue({ ...upstream, issue_number: target.number, content })).data.id;
      case "issue-comment":
        return (await this.gh.rest.reactions.createForIssueComment({ ...upstream, comment_id: target.id, content })).data.id;
      case "review-comment":
        return (await this.gh.rest.reactions.createForPullRequestReviewComment({ ...upstream, comment_id: target.id, content })).data.id;
    }
  }

  async unreact(upstream: RepoRef, target: ReactionTarget, reactionId: number): Promise<void> {
    try {
      switch (target.kind) {
        case "issue":
          await this.gh.rest.reactions.deleteForIssue({ ...upstream, issue_number: target.number, reaction_id: reactionId });
          return;
        case "issue-comment":
          await this.gh.rest.reactions.deleteForIssueComment({ ...upstream, comment_id: target.id, reaction_id: reactionId });
          return;
        case "review-comment":
          await this.gh.rest.reactions.deleteForPullRequestComment({ ...upstream, comment_id: target.id, reaction_id: reactionId });
          return;
      }
    } catch (error: unknown) {
      if (httpStatus(error) !== 404) throw error;
    }
  }

  /** Locked conversations and interaction limits answer 403/422: surface them as CannotPost. */
  private async posting<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error: unknown) {
      const status = httpStatus(error);
      if (status === 403 || status === 422) throw new CannotPost(status);
      throw error;
    }
  }
}
