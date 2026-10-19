import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { type RunContext, Ticket } from "@open-macaron/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TicketAlreadyRedeemed, TicketRejected } from "../../src/common/errors.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { EventsRepository } from "../../src/ingest/events.repository.ts";
import { Jobs, Queue } from "../../src/jobs/jobs.ts";
import { RunNotBoundYet, RunsRepository } from "../../src/runs/runs.repository.ts";
import { testEnv } from "../support/env.ts";
import { runContext } from "../support/fixtures.ts";
import { startPostgres } from "../support/postgres.ts";

let container: StartedPostgreSqlContainer;
let db: Db;
let runs: RunsRepository;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
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
    limitMicros: 1_000_000,
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
      limitMicros: 1,
    });
    expect([run.loop, second.loop]).toEqual([1, 2]);
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
    const event = { threadId: thread.id, externalId: "issue-comment:1", author: "alice", kind: "mention" as const, url: "https://x", body: "@macaron-bot implement" };

    expect(await events.add(event)).toBe(true);
    expect(await events.add(event)).toBe(false);
    expect(await events.pending(thread.id)).toHaveLength(1);
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
