import { type Changes, CommitSha } from "@open-macaron/contracts";
import { Changes as ChangesSchema } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { gate, type GateInput } from "../../src/publish/gate.ts";
import { diffFileFromPatch as toDiffFile } from "@open-macaron/review";
import { BASE_SHA, PNG, runContext, runResult, SVG, text, WEBM } from "../support/fixtures.ts";

const changes = (files: readonly unknown[], baseSha = BASE_SHA): Changes => ChangesSchema.parse({ baseSha, files });
const upsert = (path: string, content: string) => ({ action: "upsert", path, mode: "100644", contentBase64: text(content) });

async function check(overrides: Partial<GateInput> = {}): Promise<readonly string[]> {
  const verdict = await gate({
    mode: "implement",
    context: runContext(),
    result: runResult(),
    changes: changes([upsert("src/app.ts", "export const ok = true;\n")]),
    media: new Map(),
    ...overrides,
  });
  return verdict.ok ? [] : verdict.violations;
}

describe("gate", () => {
  it("accepts a clean commit", async () => {
    expect(await check()).toEqual([]);
  });

  it("refuses actions the mode does not allow", async () => {
    expect(await check({ mode: "triage" })).toEqual(['action "commit" is not allowed in mode "triage"']);
    expect(await check({ mode: "reproduce" })).toEqual(['action "commit" is not allowed in mode "reproduce"']);
  });

  it("refuses changes on another base commit", async () => {
    expect(await check({ changes: changes([upsert("a.txt", "x")], "b".repeat(40)) })).toEqual(["changes were made on another base commit"]);
  });

  it.each([".github/workflows/ci.yml", ".github/CODEOWNERS", ".gitmodules", "vendor/.git/config"])("refuses to touch %s", async (path) => {
    expect(await check({ changes: changes([upsert(path, "x")]) })).toEqual([expect.stringContaining("may not be changed")]);
  });

  it("refuses binaries and oversized files", async () => {
    const binary = { action: "upsert", path: "a.bin", mode: "100644", contentBase64: Buffer.from([1, 0, 2]).toString("base64") };
    expect(await check({ changes: changes([binary]) })).toEqual([expect.stringContaining("binary")]);

    const limits = { maxChangedFiles: 10, maxFileBytes: 4, maxTotalBytes: 100 };
    expect(await check({ changes: changes([upsert("a.txt", "too long")]), limits })).toEqual([expect.stringContaining("limit is 4")]);
  });

  it("refuses a commit without changes", async () => {
    expect(await check({ changes: undefined })).toEqual(["action is commit but there are no changes"]);
  });

  it("refuses credentials in files and in texts, naming each kind once", async () => {
    const token = `ghp_${"A".repeat(36)}`;
    expect(await check({ changes: changes([upsert("config.ts", `const t = "${token}";`)]) })).toEqual(["config.ts: contains a github secret"]);
    expect(await check({ result: runResult({ summary: `used sk-or-v1-${"0".repeat(64)}` }) })).toEqual(["text contains a OpenRouter API key secret"]);
  });

  describe("review mode", () => {
    const head = "c".repeat(40);
    const rule = { id: "org-x/no-eval", scope: "org-x", title: "No eval", severity: "error", appliesTo: ["src/**"], exclude: [], sources: [], body: "## Check" };
    const review = { pull: 12, baseSha: BASE_SHA, headSha: head, rules: [{ rule, files: ["src/a.ts"] }], skipped: [], knowledgeCommit: null };
    const diff = { baseSha: CommitSha.parse(BASE_SHA), headSha: CommitSha.parse(head), files: [toDiffFile("src/a.ts", undefined, "@@ -1 +1,2 @@\n ok();\n+eval(userInput);")] };
    const verdict = { ruleId: "org-x/no-eval", verdict: "violation", evidence: [{ file: "src/a.ts", line: 2, quote: "eval(userInput);" }], explanation: "eval on input" };
    const reviewInput = (result: Record<string, unknown>, extra: Partial<GateInput> = {}): GateInput => ({
      mode: "review",
      context: runContext({ mode: "review", kind: "pull", review }),
      result: runResult({ action: "review", commitMessage: undefined, pr: undefined, ...result }),
      changes: undefined,
      media: new Map(),
      diff,
      ...extra,
    });

    it("publishes verified rows", async () => {
      const outcome = await gate(reviewInput({ review: [verdict] }));
      expect(outcome.ok && outcome.publishable.review?.map((row) => [row.id, row.outcome])).toEqual([["org-x/no-eval", "violation"]]);
    });

    it("refuses file changes, verdicts for rules that weren't asked, and a missing diff", async () => {
      expect(await check(reviewInput({ review: [verdict] }, { changes: changes([upsert("src/a.ts", "x")]) }))).toEqual(['changes are only accepted with action "commit", got "review"']);
      expect(await check(reviewInput({ review: [{ ...verdict, ruleId: "global/invented" }] }))).toEqual(["verdict for a rule that wasn't asked: global/invented"]);
      expect(await check(reviewInput({ review: [verdict] }, { diff: undefined }))).toEqual(["a review run needs the pull request's diff"]);
    });
  });

  it("refuses replies to comments the agent was never shown", async () => {
    const result = runResult({ action: "reply", replies: [{ inReplyTo: 999, body: "done" }], commitMessage: undefined, pr: undefined });
    expect(await check({ mode: "address_review", result, changes: undefined })).toEqual(["reply targets unknown comment 999"]);
  });

  describe("attachments", () => {
    const reproduce = (attachments: readonly unknown[], message: string) =>
      runResult({ action: "reply", message, attachments, commitMessage: undefined, pr: undefined });

    it("accepts a video with its image preview, typed by magic bytes", async () => {
      const verdict = await gate({
        mode: "reproduce",
        context: runContext({ mode: "reproduce" }),
        result: reproduce(
          [{ id: "repro-1", path: "media/repro.webm", kind: "video", caption: "Crash", preview: "media/repro.png" }],
          "Reproduced: ![Crash](attachment:repro-1)",
        ),
        changes: undefined,
        media: new Map([
          ["media/repro.webm", WEBM],
          ["media/repro.png", PNG],
        ]),
      });

      expect(verdict.ok && verdict.publishable.attachments.map((a) => [a.media.mime, a.previewMedia?.mime])).toEqual([["video/webm", "image/png"]]);
    });

    it("refuses SVG (or anything else) disguised with an image extension", async () => {
      const violations = await check({
        mode: "reproduce",
        context: runContext({ mode: "reproduce" }),
        result: reproduce([{ id: "x", path: "media/x.png", kind: "image", caption: "x" }], "![x](attachment:x)"),
        changes: undefined,
        media: new Map([["media/x.png", SVG]]),
      });

      expect(violations).toEqual(["attachment x: media/x.png is not an allowed image or video type"]);
    });

    it("refuses missing files and references to unknown attachments", async () => {
      const violations = await check({
        mode: "reproduce",
        context: runContext({ mode: "reproduce" }),
        result: reproduce([{ id: "a", path: "media/a.png", kind: "image", caption: "a" }], "![a](attachment:a) ![b](attachment:b)"),
        changes: undefined,
        media: new Map(),
      });

      expect(violations).toEqual(["attachment a: media/a.png is missing from the artifact", 'reference to unknown attachment "b"']);
    });
  });
});
