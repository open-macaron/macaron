import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CommitSha, type PublishedConfig, type RunContext, Ticket } from "@open-macaron/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TicketAlreadyRedeemed, TicketRejected } from "../../src/common/errors.ts";
import { DrizzleConfigSnapshotStore } from "../../src/config/config-snapshots.store.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { createGitHub } from "../../src/github/github.ts";
import type { RepoRef } from "../../src/github/repo-ref.ts";
import { EventsRepository } from "../../src/ingest/events.repository.ts";
import { Jobs, Queue } from "../../src/jobs/jobs.ts";
import { ReactionTargets } from "../../src/publish/reaction-targets.ts";
import { type ReactionContent, type ReactionTarget, UpstreamWriter } from "../../src/publish/upstream-writer.ts";
import { RunNotBoundYet, RunsRepository } from "../../src/runs/runs.repository.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext } from "../support/fixtures.ts";
import { insertPayer, PAYER_ID } from "../support/payer.ts";
import { startPostgres } from "../support/postgres.ts";

let container: StartedPostgreSqlContainer;
let db: Db;
let runs: RunsRepository;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await insertPayer(db);
  runs = new RunsRepository(db);
});

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

const ticket = (n: number) => Ticket.parse(`t_${String(n).padStart(43, "0")}`);
const context: RunContext = runContext();

async function newRun(n: number) {
  const thread = await runs.thread("org-x/repo-a", 1000 + n, "issue");
  const run = await runs.createRun({
    threadId: thread.id,
    ticket: ticket(n),
    mode: "implement",
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
    fastModel: "anthropic/claude-haiku-5.5",
    context,
    route: { mode: "implement", subject: { kind: "issue", number: 1000 + n }, checkout: { from: "defaultBranch" }, branch: `macaron/${String(1000 + n)}-work` },
    limitMicros: 1_000_000,
    triggerGithubId: 583231,
    payerId: PAYER_ID,
  });
  return { thread, run };
}

describe("migrations at startup", () => {
  it("are idempotent: a second instance starting finds nothing to do", async () => {
    const second = await connectAndMigrate(container.getConnectionUri());
    await second.$client.end();
    const result = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name = 'runs'`);
    expect(result.rows).toEqual([{ n: 1 }]);
  });
});

describe("DrizzleConfigSnapshotStore", () => {
  it("returns the configuration applied last, and moves a commit applied again", async () => {
    const store = new DrizzleConfigSnapshotStore(db);
    const one: PublishedConfig = { version: 1, commit: CommitSha.parse("1".repeat(40)), files: { "global.yaml": "one" } };
    const two: PublishedConfig = { version: 1, commit: CommitSha.parse("2".repeat(40)), files: { "global.yaml": "two" } };

    expect(await store.latest()).toBeUndefined();
    await store.applied(one);
    await store.applied(two);
    expect(await store.latest()).toEqual(two);
    await store.applied(one);
    expect(await store.latest()).toEqual(one);
  });
});

describe("RunsRepository", () => {
  it("numbers loops per thread", async () => {
    const { thread, run } = await newRun(1);
    const second = await runs.createRun({
      threadId: thread.id,
      ticket: ticket(101),
      mode: "address_review",
      harness: "claude",
      model: run.model,
      fastModel: "anthropic/claude-haiku-5.5",
      context,
      route: { mode: "address_review", subject: { kind: "ownPullRequest", number: 7 }, checkout: { from: "botBranch" }, branch: "macaron/1001-work" },
      limitMicros: 1,
      triggerGithubId: 583231,
      payerId: PAYER_ID,
    });
    expect([run.loop, second.loop]).toEqual([1, 2]);
    expect((await runs.byId(second.id)).route).toEqual({ mode: "address_review", subject: { kind: "ownPullRequest", number: 7 }, checkout: { from: "botBranch" }, branch: "macaron/1001-work" });
  });

  it("hands out a key once, only to the workflow run it was dispatched as, and wipes it", async () => {
    const { run } = await newRun(2);
    await runs.attachKey(run.id, { backend: "openrouter", hash: "hash-2", key: "sk-or-v1-secret" });

    await expect(runs.redeem(ticket(2), 555, new Date())).rejects.toBeInstanceOf(RunNotBoundYet);
    await runs.markDispatched(run.id, 555);
    await expect(runs.redeem(ticket(2), 999, new Date())).rejects.toBeInstanceOf(TicketRejected);

    const redemption = await runs.redeem(ticket(2), 555, new Date());
    expect(redemption.key).toBe("sk-or-v1-secret");
    expect((await runs.byId(run.id)).keySecret).toBeNull();

    await expect(runs.redeem(ticket(2), 555, new Date())).rejects.toBeInstanceOf(TicketAlreadyRedeemed);
  });

  it("lets exactly one of two concurrent redemptions win", async () => {
    const { run } = await newRun(3);
    await runs.attachKey(run.id, { backend: "openrouter", hash: "hash-3", key: "sk-or-v1-race" });
    await runs.markDispatched(run.id, 777);

    const outcomes = await Promise.allSettled([runs.redeem(ticket(3), 777, new Date()), runs.redeem(ticket(3), 777, new Date())]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  });

  it("closes a run once, keeps its limit reserved until settled, then writes its cost to the ledger once", async () => {
    const { thread, run } = await newRun(4);
    const attribution = { repo: "org-x/repo-a", project: "sandbox" };
    const outcome = { status: "completed" as const, failure: null };

    expect([await runs.finish(run.id, outcome, new Date()), await runs.finish(run.id, outcome, new Date())]).toEqual([true, false]);
    expect(await runs.reservedMicros({ threadId: thread.id })).toBe(1_000_000);

    expect([await runs.settle(run.id, 1_840_000, attribution, new Date()), await runs.settle(run.id, 1_840_000, attribution, new Date())]).toEqual([true, false]);
    expect(await runs.reservedMicros({ threadId: thread.id })).toBe(0);
    expect(await runs.spentOnThread(thread.id)).toBe(1_840_000);
  });

  it("performs an external effect at most once", async () => {
    const { thread } = await newRun(5);
    let calls = 0;
    const effect = () => {
      calls++;
      return Promise.resolve(42);
    };

    const results = await Promise.all([runs.once(thread.id, 1, "pr", effect), runs.once(thread.id, 1, "pr", effect)]);

    expect(calls).toBe(1);
    expect(results.filter((result) => result === 42)).toHaveLength(1);
    expect(await runs.effect(thread.id, 1, "pr")).toBe("42");
  });
});

describe("EventsRepository", () => {
  it("records each trigger once", async () => {
    const events = new EventsRepository(db);
    const { thread } = await newRun(6);
    const event = { threadId: thread.id, externalId: "issue-comment:1", subjectKind: "issue" as const, subjectNumber: 1006, author: "alice", authorId: 7, kind: "mention" as const, url: "https://x", body: "@macaron-bot implement" };

    expect(await events.add(event)).toBe(true);
    expect(await events.add(event)).toBe(false);
    expect(await events.pending(thread.id)).toMatchObject([{ subjectKind: "issue", subjectNumber: 1006 }]);
  });
});

describe("effects", () => {
  it("moves a request's effects to the loop that answers it, leaving others", async () => {
    const { thread } = await newRun(7);
    await runs.once(thread.id, 0, "eyes:issue-comment:1", () => Promise.resolve("a"));
    await runs.once(thread.id, 0, "eyes:issue-comment:2", () => Promise.resolve("b"));

    await runs.moveEffects(thread.id, 0, 2, ["eyes:issue-comment:1"]);

    expect(await runs.effect(thread.id, 2, "eyes:issue-comment:1")).toBe("a");
    expect(await runs.effect(thread.id, 0, "eyes:issue-comment:1")).toBeUndefined();
    expect(await runs.effect(thread.id, 0, "eyes:issue-comment:2")).toBe("b");
  });
});

class RecordingWriter extends UpstreamWriter {
  readonly reactions: { target: ReactionTarget; content: ReactionContent }[] = [];

  constructor() {
    super(createGitHub("test", "token", "2026-03-10", { throttled: false }));
  }

  override react(_upstream: RepoRef, target: ReactionTarget, content: ReactionContent): Promise<number> {
    this.reactions.push({ target, content });
    return Promise.resolve(this.reactions.length);
  }
}

describe("ReactionTargets.refuse", () => {
  const upstream = { owner: "org-x", repo: "repo-a" };

  it("gives 👎 once per untrusted user and thread, separate from the loops' reactions", async () => {
    const { thread } = await newRun(8);
    const writer = new RecordingWriter();
    const reactions = new ReactionTargets(runs, writer, new FakeClock());

    await reactions.refuse(thread.id, upstream, "Stranger", { kind: "issue-comment", id: 1 });
    await reactions.refuse(thread.id, upstream, "stranger", { kind: "issue-comment", id: 2 });
    await reactions.refuse(thread.id, upstream, "other", { kind: "issue-comment", id: 3 });
    await reactions.finish(thread.id, 1, upstream, "+1");

    expect(writer.reactions).toEqual([
      { target: { kind: "issue-comment", id: 1 }, content: "-1" },
      { target: { kind: "issue-comment", id: 3 }, content: "-1" },
    ]);
  });

  it("stops reacting past the hourly cap, and resumes an hour later", async () => {
    const { thread } = await newRun(9);
    const writer = new RecordingWriter();
    const clock = new FakeClock();
    const reactions = new ReactionTargets(runs, writer, clock);

    for (let user = 0; user < 31; user++) await reactions.refuse(thread.id, upstream, `user-${String(user)}`, { kind: "issue-comment", id: user + 1 });
    expect(writer.reactions).toHaveLength(30);

    clock.advance(3_600_000);
    await reactions.refuse(thread.id, upstream, "user-30", { kind: "issue-comment", id: 31 });
    expect(writer.reactions).toHaveLength(31);
  });
});

describe("Jobs (pg-boss)", () => {
  it("debounces a thread: a burst of triggers is one job, pushed back by each trigger", async () => {
    const jobs = new Jobs(testEnv({ DATABASE_URL: container.getConnectionUri() }));
    await jobs.onModuleInit();
    try {
      const threadId = "00000000-0000-4000-8000-000000000001";
      await jobs.threadReady(threadId, 60_000);
      const first = await db.execute(sql`select start_after from pgboss.job where name = ${Queue.threadReady} and singleton_key = ${threadId}`);
      await jobs.threadReady(threadId, 120_000);
      const after = await db.execute(sql`select start_after from pgboss.job where name = ${Queue.threadReady} and singleton_key = ${threadId}`);

      expect(after.rows).toHaveLength(1);
      expect(String(after.rows[0]?.["start_after"])).not.toBe(String(first.rows[0]?.["start_after"]));
    } finally {
      await jobs.onApplicationShutdown();
    }
  });
});
