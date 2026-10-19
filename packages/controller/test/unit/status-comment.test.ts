import { describe, expect, it } from "vitest";
import { reactionTargetOf } from "../../src/publish/reaction-targets.ts";
import { statusComment } from "../../src/publish/status-comment.ts";

const issueThread = { kind: "issue" as const, number: 16, prNumber: 17, statusCommentId: 101, prStatusCommentId: 202 };

describe("statusComment", () => {
  it("answers a request on the issue in the issue's status comment, even with an open pull request", () => {
    expect(statusComment(issueThread, { kind: "issue", number: 16 })).toEqual({ number: 16, commentId: 101, column: "statusCommentId" });
  });

  it("answers a request on the bot's pull request in that pull request's status comment", () => {
    expect(statusComment(issueThread, { kind: "ownPullRequest", number: 17 })).toEqual({ number: 17, commentId: 202, column: "prStatusCommentId" });
  });

  it("starts a fresh status comment on a pull request the thread no longer tracks", () => {
    expect(statusComment(issueThread, { kind: "ownPullRequest", number: 12 })).toEqual({ number: 12, commentId: null, column: undefined });
  });

  it("uses the thread's own status comment for a pull request the bot didn't open", () => {
    const pullThread = { kind: "pull" as const, number: 40, prNumber: null, statusCommentId: 303, prStatusCommentId: null };
    expect(statusComment(pullThread, { kind: "pullRequest", number: 40 })).toEqual({ number: 40, commentId: 303, column: "statusCommentId" });
  });
});

describe("reactionTargetOf", () => {
  it("reacts on the comment that made the request, or on its subject", () => {
    expect(reactionTargetOf({ externalId: "issue-comment:42", subjectNumber: 16 })).toEqual({ kind: "issue-comment", id: 42 });
    expect(reactionTargetOf({ externalId: "review-comment:43", subjectNumber: 17 })).toEqual({ kind: "review-comment", id: 43 });
    expect(reactionTargetOf({ externalId: "issue:16", subjectNumber: 16 })).toEqual({ kind: "issue", number: 16 });
    // GitHub has no reactions on reviews: the pull request itself.
    expect(reactionTargetOf({ externalId: "review:44", subjectNumber: 17 })).toEqual({ kind: "issue", number: 17 });
  });
});
