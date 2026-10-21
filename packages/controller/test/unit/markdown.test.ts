import { describe, expect, it } from "vitest";
import { CommitSha, PublishedLesson } from "@open-macaron/contracts";
import { renderCostTable, resolveAttachments, sanitize, spentLine, statusHeader, upsertCostSection, withSpentLine } from "../../src/publish/markdown.ts";

describe("sanitize", () => {
  it("keeps mentions of thread participants and defangs everyone else", () => {
    expect(sanitize("Thanks @alice, cc @torvalds and @org/team", new Set(["Alice"]))).toBe(
      "Thanks @alice, cc `@torvalds` and `@org/team`",
    );
  });

  it("leaves emails, already-quoted mentions and code blocks alone", () => {
    const body = "mail me@example.com, `@bob` here\n```\n@carol in code\n```\n";
    expect(sanitize(body, new Set())).toBe(body);
  });

  it("strips forged macaron markers so the cost table cannot be spoofed", () => {
    expect(sanitize("a<!-- macaron:cost:start -->b<!--macaron:x-->c", new Set())).toBe("abc");
  });

  it("truncates oversized bodies", () => {
    expect(sanitize("x".repeat(70_000), new Set()).endsWith("…(truncated)")).toBe(true);
  });
});

describe("resolveAttachments", () => {
  it("rewrites references to hosted URLs", () => {
    const urls = new Map([["repro-1", "https://github.com/open-macaron/evidence/releases/download/t/x/repro.gif"]]);
    expect(resolveAttachments("![Crash](attachment:repro-1)", urls)).toBe(
      "![Crash](https://github.com/open-macaron/evidence/releases/download/t/x/repro.gif)",
    );
  });
});

describe("cost table", () => {
  const table = renderCostTable(
    [
      { loop: 1, state: "completed", trigger: "mention by @alice", mode: "implement", model: "anthropic/claude-sonnet-5.5", costMicros: 1_840_000, runUrl: "https://r/1" },
      { loop: 2, state: "failed", trigger: "review by @bob", mode: "address_review", model: "anthropic/claude-sonnet-5.5", costMicros: 620_000, runUrl: null },
    ],
    4_000,
    4,
  );

  it("lists every loop with its state, router spend and the total", () => {
    expect(table).toContain("| 1 | mention by @alice | implement | ✅ done | claude-sonnet-5.5 | $1.84 | [run](https://r/1) |");
    expect(table).toContain("| 2 | review by @bob | address_review | 😕 failed | claude-sonnet-5.5 | $0.62 | |");
    expect(table).toContain("| – | 4 routed comments | router | | | $0.0040 | |");
    expect(table).toContain("| **Total** | | | | | **$2.46** | |");
    expect(table).toContain("<summary>macaron-bot cost: <b>$2.46</b> (2 loops)</summary>");
  });

  it("shows ⏳ for loops whose cost isn't settled yet, in the rows and the total", () => {
    const pending = renderCostTable([{ loop: 1, state: "running", trigger: "t", mode: "implement", model: "m", costMicros: null, runUrl: null }], 0, 0);
    expect(pending).toContain("| ⏳ running | m | ⏳ |");
    expect(pending).toContain("<b>$0.00 ⏳</b>");
  });

  it("replaces the previous section in place and keeps the rest of the body", () => {
    const first = upsertCostSection("Fixes #12", table);
    const second = upsertCostSection(`${first}\nfooter`, table.replace("$1.84", "$9.99"));

    expect(second.startsWith("Fixes #12\n\n")).toBe(true);
    expect(second.match(/macaron:cost:start/g)).toHaveLength(1);
    expect(second).toContain("$9.99");
    expect(second.endsWith("footer")).toBe(true);
  });
});

describe("status header", () => {
  const none = { commit: null, lessons: [] };
  const lesson = PublishedLesson.parse({
    id: "podman-desktop/lessons/windows-machines",
    scope: "podman-desktop",
    topic: "Windows machines",
    appliesTo: null,
    sources: ["https://github.com/axel7083/podman-desktop/issues/40"],
    lastVerified: "2026-10-21",
    confidence: "medium",
    body: "Hyper-V works.",
  });

  it("names the mode, and nothing else a Linux run without lessons has", () => {
    expect(statusHeader({ loop: 1, mode: "plan", platform: "linux", runUrl: null, knowledge: none })).toBe("**macaron-bot** · loop 1 · `plan`");
  });

  it("names another platform and the lessons the run was given, with their commit", () => {
    const commit = CommitSha.parse("abcdef1".padEnd(40, "0"));
    expect(statusHeader({ loop: 2, mode: "reproduce", platform: "windows", runUrl: "https://example.org/run", knowledge: { commit, lessons: [lesson] } })).toBe(
      `**macaron-bot** · loop 2 · \`reproduce\` · Windows · [run](https://example.org/run) · 1 lesson from [open-macaron/knowledge@abcdef1](https://github.com/open-macaron/knowledge/tree/${commit})`,
    );
  });
});

describe("spent line", () => {
  const status = ["**macaron-bot** · loop 1 · `plan`", "", "✅ Plan posted.", "", "<sub>Spent on this thread: $0.00 ⏳.</sub>"].join("\n");

  it("shows the thread's cost, with ⏳ while a loop is settling", () => {
    expect(spentLine(258_972, false)).toBe("<sub>Spent on this thread: $0.26.</sub>");
    expect(spentLine(0, true)).toBe("<sub>Spent on this thread: $0.00 ⏳.</sub>");
  });

  it("replaces only the spent line of a status comment", () => {
    expect(withSpentLine(status, spentLine(258_972, false))).toBe(status.replace("$0.00 ⏳", "$0.26"));
    expect(withSpentLine("edited by a maintainer", spentLine(1, false))).toBe("edited by a maintainer");
  });
});
