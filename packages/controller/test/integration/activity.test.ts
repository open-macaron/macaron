import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { AdminRefusalsQuery, AdminRunsQuery, Ticket } from "@open-macaron/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityService } from "../../src/accounts/activity.service.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { events as eventsTable, runs as runsTable, users } from "../../src/db/schema.ts";
import { EventsRepository, type NewEvent } from "../../src/ingest/events.repository.ts";
import { RunsRepository } from "../../src/runs/runs.repository.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext } from "../support/fixtures.ts";
import { startPostgres } from "../support/postgres.ts";

const env = testEnv({ RUNNER_REPO: "open-macaron/runner" });
const MONALISA = 101;
/** A GitHub id no account has: a review bot, or a user deleted since. */
const NO_ACCOUNT = 777;

let container: StartedPostgreSqlContainer;
let db: Db;
let activity: ActivityService;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await db.insert(users).values({ id: "monalisa", name: "Mona Lisa", email: "mona@example.test", image: "https://avatars.example.test/101", githubId: MONALISA, githubLogin: "monalisa" });
  activity = new ActivityService(db, env, new FakeClock(new Date("2026-10-23T12:00:00Z")));

  const runs = new RunsRepository(db);
  const launches = [
    { repo: "org-x/repo-a", number: 1, asker: MONALISA, at: "2026-09-30T00:00:00Z", outcome: "completed" },
    { repo: "org-x/repo-a", number: 2, asker: MONALISA, at: "2026-10-02T00:00:00Z", outcome: "failed" },
    { repo: "org-x/repo-b", number: 3, asker: NO_ACCOUNT, at: "2026-10-03T00:00:00Z", outcome: "completed" },
    { repo: "org-x/repo-b", number: 4, asker: MONALISA, at: "2026-10-04T00:00:00Z", outcome: "running" },
  ];
  for (const [index, launch] of launches.entries()) {
    const thread = await runs.thread(launch.repo, launch.number, "issue");
    const run = await runs.createRun({
      threadId: thread.id,
      ticket: Ticket.parse(`t_${String(index).padStart(43, "5")}`),
      mode: launch.outcome === "failed" ? "implement" : "plan",
      harness: "claude",
      model: "claude-sonnet-5-5",
      fastModel: "claude-haiku-4-5",
      context: runContext({ mode: "plan", trigger: { kind: "mention", author: launch.asker === MONALISA ? "mona-old-login" : "review-bot", url: `https://github.com/${launch.repo}/issues/${String(launch.number)}#issuecomment-1`, instruction: "@macaron-bot plan" } }),
      route: { mode: "plan", subject: { kind: "issue", number: launch.number }, checkout: { from: "defaultBranch" }, branch: `macaron/${String(launch.number)}-work` },
      limitMicros: 2_000_000,
      triggerGithubId: launch.asker,
      payerId: "monalisa",
    });
    await runs.markDispatched(run.id, 9000 + index);
    if (launch.outcome !== "running") {
      await runs.finish(run.id, { status: launch.outcome === "failed" ? "failed" : "completed", failure: launch.outcome === "failed" ? "the agent ran out of turns" : null }, new Date(launch.at));
      await runs.settle(run.id, 500_000, { repo: launch.repo, project: "x" }, new Date(launch.at));
    }
    await db.update(runsTable).set({ createdAt: new Date(launch.at) }).where(eq(runsTable.id, run.id));
  }
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

describe("ActivityService.runs", () => {
  it("lists every user's runs newest first, with who asked and where to look", async () => {
    const first = await activity.runs(AdminRunsQuery.parse({ limit: 2 }));
    expect(first.runs.map((run) => run.number)).toEqual([4, 3]);
    expect(first.runs[0]).toMatchObject({
      asker: { githubId: MONALISA, login: "monalisa", name: "Mona Lisa", avatarUrl: "https://avatars.example.test/101", hasAccount: true },
      triggerUrl: "https://github.com/org-x/repo-b/issues/4#issuecomment-1",
      runUrl: "https://github.com/open-macaron/runner/actions/runs/9003",
      limitUsd: 2,
      costUsd: null,
    });
    // Without an account, the login is the one the comment was written under.
    expect(first.runs[1]?.asker).toEqual({ githubId: NO_ACCOUNT, login: "review-bot", name: null, avatarUrl: null, hasAccount: false });
    // September's run is on the next page, and out of this month's totals.
    expect(first).toMatchObject({ monthRuns: 3, monthFailed: 1, monthUsd: 1 });

    const second = await activity.runs(AdminRunsQuery.parse({ limit: 2, before: first.nextCursor ?? undefined }));
    expect(second.runs.map((run) => run.number)).toEqual([2, 1]);
    expect(second.runs[0]).toMatchObject({ status: "failed", failure: "the agent ran out of turns" });
    expect(second.nextCursor).toBeNull();
  });

  it("filters by asker, repository, status and mode, totals included", async () => {
    const mine = await activity.runs(AdminRunsQuery.parse({ user: String(MONALISA) }));
    expect(mine.runs.map((run) => run.number)).toEqual([4, 2, 1]);
    expect(mine).toMatchObject({ monthRuns: 2, monthFailed: 1, monthUsd: 0.5 });
    expect((await activity.runs(AdminRunsQuery.parse({ repo: "org-x/repo-b" }))).runs.map((run) => run.number)).toEqual([4, 3]);
    expect((await activity.runs(AdminRunsQuery.parse({ status: "failed" }))).runs.map((run) => run.number)).toEqual([2]);
    expect((await activity.runs(AdminRunsQuery.parse({ mode: "implement", repo: "org-x/repo-b" }))).runs).toEqual([]);
  });
});

describe("ActivityService.refusals", () => {
  it("lists refused requests with their reason, including those `retry` replayed since", async () => {
    const runs = new RunsRepository(db);
    const events = new EventsRepository(db);
    const thread = await runs.thread("org-x/repo-c", 5, "issue");
    const request = { threadId: thread.id, subjectKind: "issue", subjectNumber: 5, kind: "mention", body: "@macaron-bot implement" } satisfies Partial<NewEvent>;
    await events.add({ ...request, externalId: "issue-comment:1", author: "monalisa", authorId: MONALISA, url: "https://github.com/org-x/repo-c/issues/5#issuecomment-1" });
    await events.add({ ...request, externalId: "issue-comment:2", author: "hubot", authorId: 102, url: "https://github.com/org-x/repo-c/issues/5#issuecomment-2" });
    await events.add({ ...request, externalId: "issue-comment:3", author: "hubot", authorId: 102, url: "https://github.com/org-x/repo-c/issues/5#issuecomment-3" });
    const [first, second, third] = await events.pending(thread.id);
    await events.settle([first?.id ?? ""], "refused", "@monalisa has no LLM key");
    await events.settle([second?.id ?? ""], "refused", "the repository's monthly budget is spent");
    // Replayed by `retry`: done now, but it was refused once.
    await events.settle([second?.id ?? ""], "done");
    await events.settle([third?.id ?? ""], "done");
    await db.update(eventsTable).set({ createdAt: new Date("2026-10-01T00:00:00Z") }).where(eq(eventsTable.id, first?.id ?? ""));

    const page = await activity.refusals(AdminRefusalsQuery.parse({ limit: 1 }));
    expect(page.refusals).toMatchObject([{ author: "hubot", authorId: 102, repo: "org-x/repo-c", number: 5, reason: "the repository's monthly budget is spent" }]);
    const next = await activity.refusals(AdminRefusalsQuery.parse({ limit: 1, before: page.nextCursor ?? undefined }));
    expect(next.refusals).toMatchObject([{ author: "monalisa", reason: "@monalisa has no LLM key" }]);
    expect(next.nextCursor).toBeNull();
    expect((await activity.refusals(AdminRefusalsQuery.parse({ user: String(MONALISA) }))).refusals.map((refusal) => refusal.author)).toEqual(["monalisa"]);
    expect((await activity.refusals(AdminRefusalsQuery.parse({ repo: "org-x/repo-a" }))).refusals).toEqual([]);
  });
});
