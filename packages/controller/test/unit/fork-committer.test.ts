import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGitHub } from "../../src/github/github.ts";
import { ForkCommitter } from "../../src/publish/fork-committer.ts";

const FORK_API = "https://api.github.com/repos/macaron-bot/knowledge";
const FORK = { owner: "macaron-bot", repo: "knowledge" };
const BASE = "1".repeat(40);
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

/** The fork's API, recording the writes in order; `existing` is the branch head, if the branch exists. */
function fork(existing?: string): string[] {
  const calls: string[] = [];
  server.use(
    http.get(`${FORK_API}/git/ref/*`, () => (existing === undefined ? HttpResponse.json({ message: "Not Found" }, { status: 404 }) : HttpResponse.json({ object: { sha: existing } }))),
    http.post(`${FORK_API}/merge-upstream`, () => {
      calls.push("merge-upstream");
      return HttpResponse.json({ merge_type: "fast-forward" });
    }),
    http.post(`${FORK_API}/git/refs`, () => {
      calls.push("create-ref");
      return HttpResponse.json({}, { status: 201 });
    }),
  );
  return calls;
}

const committer = () => new ForkCommitter(createGitHub("test", "token", "2026-03-10", { throttled: false }));

describe("ForkCommitter.ensureBranch", () => {
  it("syncs the fork before creating a branch, so the new ref brings no upstream workflow changes", async () => {
    const calls = fork();
    expect(await committer().ensureBranch(FORK, "lessons/global/run-1", BASE, "main")).toBe(BASE);
    expect(calls).toEqual(["merge-upstream", "create-ref"]);
  });

  it("reuses an existing branch as it is, without syncing", async () => {
    const calls = fork("9".repeat(40));
    expect(await committer().ensureBranch(FORK, "lessons/global/run-1", BASE, "main")).toBe("9".repeat(40));
    expect(calls).toEqual([]);
  });
});
