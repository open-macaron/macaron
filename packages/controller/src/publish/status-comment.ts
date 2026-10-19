import type { Subject } from "../routing/routes.ts";
import type { ThreadRecord } from "../runs/runs.repository.ts";

/**
 * Where a subject's sticky status comment lives, and the thread column that remembers its id
 * (none for a subject the thread doesn't track, e.g. an earlier pull request of the bot's).
 */
export interface StatusComment {
  readonly number: number;
  readonly commentId: number | null;
  readonly column: "statusCommentId" | "prStatusCommentId" | undefined;
}

/** One status comment per subject: on the issue, on the bot's pull request, or on another pull request. */
export function statusComment(thread: Pick<ThreadRecord, "kind" | "number" | "prNumber" | "statusCommentId" | "prStatusCommentId">, subject: Subject): StatusComment {
  switch (subject.kind) {
    case "issue":
      return { number: thread.number, commentId: thread.statusCommentId, column: "statusCommentId" };
    case "ownPullRequest":
      return subject.number === thread.prNumber
        ? { number: subject.number, commentId: thread.prStatusCommentId, column: "prStatusCommentId" }
        : { number: subject.number, commentId: null, column: undefined };
    case "pullRequest":
      return thread.kind === "pull" && subject.number === thread.number
        ? { number: thread.number, commentId: thread.statusCommentId, column: "statusCommentId" }
        : { number: subject.number, commentId: null, column: undefined };
  }
}
