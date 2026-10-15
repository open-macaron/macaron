import { describe, expect, it } from "vitest";
import { renderStatus, STATUS_MARKER } from "../src/status.ts";

const HEAD = "a".repeat(40);
const RUN = "https://github.com/open-macaron/knowledge/actions/runs/1";

describe("renderStatus", () => {
  it("lists each folder's state, pings the owners still needed, and explains blockers", () => {
    const body = renderStatus(
      {
        ready: false,
        formatValid: false,
        unownedFiles: 2,
        folders: [
          { folder: "projects/sandbox", state: "approved", by: ["axel7083"] },
          { folder: "repos/axel7083/foobar-tmp-demo", state: "waiting", owners: ["alice", "bob"] },
        ],
      },
      { kind: "not_ready" },
      HEAD,
      RUN,
    );
    expect(body.startsWith(`${STATUS_MARKER}\n**Merge status** for \`aaaaaaa\``)).toBe(true);
    expect(body).toContain("| `projects/sandbox` | ✅ approved by @axel7083 |");
    expect(body).toContain("| `repos/axel7083/foobar-tmp-demo` | ⏳ waiting for an owner: @alice, @bob |");
    expect(body).toContain("❌ The format check failed for this commit");
    expect(body).toContain("2 paths are outside folders");
  });

  it("reports the merge commit, or why GitHub refused", () => {
    const decision = { ready: true, formatValid: true, unownedFiles: 0, folders: [{ folder: "global", state: "approved" as const, by: ["axel7083"] }] };
    expect(renderStatus(decision, { kind: "merged", sha: "d".repeat(40) }, HEAD, RUN)).toContain("✅ Merged as `ddddddd`.");
    expect(renderStatus(decision, { kind: "refused", reason: "HTTP 409" }, HEAD, RUN)).toContain("GitHub refused the merge: HTTP 409");
  });
});
