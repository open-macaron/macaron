import { describe, expect, it } from "vitest";
import { reactionTargetOf } from "../../src/publish/reaction-targets.ts";

describe("reactionTargetOf", () => {
  it("reacts on the comment that made the request, or on its subject", () => {
    expect(reactionTargetOf({ externalId: "issue-comment:42", subjectNumber: 16 })).toEqual({ kind: "issue-comment", id: 42 });
    expect(reactionTargetOf({ externalId: "review-comment:43", subjectNumber: 17 })).toEqual({ kind: "review-comment", id: 43 });
    expect(reactionTargetOf({ externalId: "issue:16", subjectNumber: 16 })).toEqual({ kind: "issue", number: 16 });
    // GitHub has no reactions on reviews: the pull request itself.
    expect(reactionTargetOf({ externalId: "review:44", subjectNumber: 17 })).toEqual({ kind: "issue", number: 17 });
  });
});
