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

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
export const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

export function text(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}
