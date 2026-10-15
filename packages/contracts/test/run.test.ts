import { describe, expect, it } from "vitest";
import { RunResult, allowedActions } from "../src/index.ts";

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

  it("rejects attachment paths outside media/ and duplicate ids", () => {
    const outside = { id: "a", path: "../etc/passwd", kind: "image", caption: "x" };
    expect(RunResult.safeParse({ ...base, action: "reply", attachments: [outside] }).success).toBe(false);

    const one = { id: "a", path: "media/a.png", kind: "image", caption: "x" };
    expect(RunResult.safeParse({ ...base, action: "reply", attachments: [one, one] }).success).toBe(false);
  });

  it("never lets triage or reproduce commit", () => {
    expect(allowedActions.triage).not.toContain("commit");
    expect(allowedActions.reproduce).not.toContain("commit");
    expect(allowedActions.verify).not.toContain("commit");
  });
});
