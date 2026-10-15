import { RunContext, RunResult } from "@open-macaron/contracts";

export const BASE_SHA = "a".repeat(40);

export function runContext(overrides: Partial<Record<keyof RunContext, unknown>> = {}): RunContext {
  return RunContext.parse({
    mode: "implement",
    repo: "org-x/repo-a",
    number: 12,
    kind: "issue",
    title: "Crash on start",
    baseSha: BASE_SHA,
    branch: "macaron/12-crash-on-start",
    trigger: {
      kind: "mention",
      author: "alice",
      url: "https://github.com/org-x/repo-a/issues/12#issuecomment-100",
      instruction: "@macaron-bot implement",
    },
    thread: [{ id: 100, author: "alice", body: "@macaron-bot implement", createdAt: "2026-10-15T11:00:00Z" }],
    reviewComments: [
      { id: 200, author: "bob", body: "Rename this", path: "src/a.ts", line: 3, inReplyTo: null, createdAt: "2026-10-15T11:10:00Z" },
    ],
    priorLoops: [],
    commands: { test: "npm test" },
    attachments: { maxFiles: 10, maxFileBytes: 5_000_000, maxTotalBytes: 50_000_000 },
    ...overrides,
  });
}

export function runResult(overrides: Partial<Record<keyof RunResult, unknown>> = {}): RunResult {
  return RunResult.parse({
    action: "commit",
    commitMessage: "fix: do not crash on start",
    pr: { title: "Fix crash on start", body: "Fixes #12" },
    replies: [],
    summary: "Guarded the null config.",
    attachments: [],
    learnings: [],
    ...overrides,
  });
}

/** A valid 1×1 PNG. */
export const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
/** A minimal EBML header with DocType "webm" (what file-type reads to tell WebM from Matroska). */
export const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77,
  0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x02, 0x42, 0x85, 0x81, 0x02,
]);
export const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

export function text(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}
