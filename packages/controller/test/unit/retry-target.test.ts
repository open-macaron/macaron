import { describe, expect, it } from "vitest";
import { retryTarget } from "../../src/ingest/retry.ts";
import type { RunStatus } from "../../src/runs/runs.repository.ts";

const earlier = new Date("2026-10-26T13:00:00Z");
const later = new Date("2026-10-26T13:14:00Z");

function loop(status: RunStatus, createdAt: Date): { status: RunStatus; createdAt: Date } {
  return { status, createdAt };
}

describe("retryTarget", () => {
  it("replays a request refused on a thread with no loop", () => {
    const refused = { createdAt: later };
    expect(retryTarget(undefined, refused)).toEqual({ kind: "refused", event: refused });
  });

  it("replays a request refused after the last loop, even a successful one", () => {
    const refused = { createdAt: later };
    expect(retryTarget(loop("completed", earlier), refused)).toEqual({ kind: "refused", event: refused });
    expect(retryTarget(loop("failed", earlier), refused)).toEqual({ kind: "refused", event: refused });
  });

  it.each<[RunStatus]>([["failed"], ["aborted"]])("reruns a %s loop newer than the last refusal", (status) => {
    const last = loop(status, later);
    expect(retryTarget(last, { createdAt: earlier })).toEqual({ kind: "loop", run: last });
    expect(retryTarget(last, undefined)).toEqual({ kind: "loop", run: last });
  });

  it("has nothing to retry after a successful loop newer than any refusal, or on an empty thread", () => {
    expect(retryTarget(loop("completed", later), { createdAt: earlier })).toEqual({ kind: "none" });
    expect(retryTarget(loop("completed", later), undefined)).toEqual({ kind: "none" });
    expect(retryTarget(undefined, undefined)).toEqual({ kind: "none" });
  });
});
