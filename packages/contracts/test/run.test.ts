import { describe, expect, it } from "vitest";
import { ReviewVerdicts, RunResult, allowedActions, fullEnvironmentModes } from "../src/index.ts";

const base = {
  replies: [],
  summary: "Reproduced on main.",
  attachments: [],
  learnings: [],
};

describe("RunResult", () => {
  it("accepts a reproduce reply with an attachment", () => {
    const result = RunResult.safeParse({
      ...base,
      action: "reply",
      message: "Reproduced: ![Crash on start](attachment:repro-1)",
      attachments: [{ id: "repro-1", path: "media/repro.webm", kind: "video", caption: "Crash on start", preview: "media/repro.gif" }],
    });

    expect(result.success).toBe(true);
  });

  it("requires escalateTo when escalating and a message when committing", () => {
    expect(RunResult.safeParse({ ...base, action: "escalate" }).success).toBe(false);
    expect(RunResult.safeParse({ ...base, action: "commit" }).success).toBe(false);
  });

  it("names a platform only when escalating", () => {
    expect(RunResult.safeParse({ ...base, action: "escalate", escalateTo: "reproduce", escalateOn: "windows" }).success).toBe(true);
    expect(RunResult.safeParse({ ...base, action: "reply", message: "Done.", escalateOn: "windows" }).success).toBe(false);
  });

  it("rejects attachment paths outside media/ and duplicate ids", () => {
    const outside = { id: "a", path: "../etc/passwd", kind: "image", caption: "x" };
    expect(RunResult.safeParse({ ...base, action: "reply", attachments: [outside] }).success).toBe(false);

    const one = { id: "a", path: "media/a.png", kind: "image", caption: "x" };
    expect(RunResult.safeParse({ ...base, action: "reply", attachments: [one, one] }).success).toBe(false);
  });

  it("carries verdicts exactly when the action is review", () => {
    const verdict = { ruleId: "sandbox/no-runtime-json-read", verdict: "violation", evidence: [{ file: "src/extension.ts", line: 12, quote: "readFile(" }], explanation: "Reads package.json at runtime." };
    expect(RunResult.safeParse({ ...base, action: "review", review: [verdict] }).success).toBe(true);
    expect(RunResult.safeParse({ ...base, action: "review" }).success).toBe(false);
    expect(RunResult.safeParse({ ...base, action: "reply", review: [verdict] }).success).toBe(false);
    expect(ReviewVerdicts.safeParse({ verdicts: [{ ...verdict, verdict: "maybe" }] }).success).toBe(false);
    expect(allowedActions.review).toEqual(["review"]);
  });

  it("lets a full review carry its verify answer next to the verdicts, and publish that answer alone", () => {
    const verdict = { ruleId: "sandbox/no-null", verdict: "pass", evidence: [], explanation: "No null." };
    expect(RunResult.safeParse({ ...base, action: "review", review: [verdict], message: "### Verdict\n✅ **Verified**: it works." }).success).toBe(true);
    expect(allowedActions.full_review).toEqual(["review", "reply", "ask", "noop"]);
    expect(fullEnvironmentModes.has("full_review")).toBe(true);
    expect(fullEnvironmentModes.has("review")).toBe(false);
  });

  it("never lets triage, reproduce or the checking modes commit", () => {
    expect(allowedActions.triage).not.toContain("commit");
    expect(allowedActions.reproduce).not.toContain("commit");
    expect(allowedActions.verify).not.toContain("commit");
    expect(allowedActions.full_review).not.toContain("commit");
  });
});
