import type { Changes } from "@open-macaron/contracts";
import { Changes as ChangesSchema } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { gate, type GateInput } from "../../src/publish/gate.ts";
import { BASE_SHA, PNG, runContext, runResult, SVG, text, WEBM } from "../support/fixtures.ts";

const changes = (files: readonly unknown[], baseSha = BASE_SHA): Changes => ChangesSchema.parse({ baseSha, files });
const upsert = (path: string, content: string) => ({ action: "upsert", path, mode: "100644", contentBase64: text(content) });

function check(overrides: Partial<GateInput> = {}): readonly string[] {
  const verdict = gate({
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
  it("accepts a clean commit", () => {
    expect(check()).toEqual([]);
  });

  it("refuses actions the mode does not allow", () => {
    expect(check({ mode: "triage" })).toEqual(['action "commit" is not allowed in mode "triage"']);
    expect(check({ mode: "reproduce" })).toEqual(['action "commit" is not allowed in mode "reproduce"']);
  });

  it("refuses changes on another base commit", () => {
    expect(check({ changes: changes([upsert("a.txt", "x")], "b".repeat(40)) })).toEqual(["changes were made on another base commit"]);
  });

  it.each([".github/workflows/ci.yml", ".github/CODEOWNERS", ".gitmodules", "vendor/.git/config"])("refuses to touch %s", (path) => {
    expect(check({ changes: changes([upsert(path, "x")]) })).toEqual([expect.stringContaining("may not be changed")]);
  });

  it("refuses binaries and oversized files", () => {
    const binary = { action: "upsert", path: "a.bin", mode: "100644", contentBase64: Buffer.from([1, 0, 2]).toString("base64") };
    expect(check({ changes: changes([binary]) })).toEqual([expect.stringContaining("binary")]);

    const limits = { maxChangedFiles: 10, maxFileBytes: 4, maxTotalBytes: 100 };
    expect(check({ changes: changes([upsert("a.txt", "too long")]), limits })).toEqual([expect.stringContaining("limit is 4")]);
  });

  it("refuses a commit without changes", () => {
    expect(check({ changes: undefined })).toEqual(["action is commit but there are no changes"]);
  });

  it("refuses credentials in files and in texts, naming each kind once", () => {
    const token = `ghp_${"A".repeat(36)}`;
    expect(check({ changes: changes([upsert("config.ts", `const t = "${token}";`)]) })).toEqual(["config.ts: contains a GitHub token"]);
    expect(check({ result: runResult({ summary: `used sk-or-v1-${"0".repeat(64)}` }) })).toEqual(["text contains a OpenRouter key"]);
  });

  it("refuses replies to comments the agent was never shown", () => {
    const result = runResult({ action: "reply", replies: [{ inReplyTo: 999, body: "done" }], commitMessage: undefined, pr: undefined });
    expect(check({ mode: "address_review", result, changes: undefined })).toEqual(["reply targets unknown comment 999"]);
  });

  describe("attachments", () => {
    const reproduce = (attachments: readonly unknown[], message: string) =>
      runResult({ action: "reply", message, attachments, commitMessage: undefined, pr: undefined });

    it("accepts a video with its image preview, typed by magic bytes", () => {
      const verdict = gate({
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

      expect(verdict.ok && verdict.publishable.attachments.map((a) => [a.type, a.previewType])).toEqual([["webm", "png"]]);
    });

    it("refuses SVG (or anything else) disguised with an image extension", () => {
      const violations = check({
        mode: "reproduce",
        context: runContext({ mode: "reproduce" }),
        result: reproduce([{ id: "x", path: "media/x.png", kind: "image", caption: "x" }], "![x](attachment:x)"),
        changes: undefined,
        media: new Map([["media/x.png", SVG]]),
      });

      expect(violations).toEqual(["attachment x: media/x.png is not an allowed image or video type"]);
    });

    it("refuses missing files and references to unknown attachments", () => {
      const violations = check({
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
