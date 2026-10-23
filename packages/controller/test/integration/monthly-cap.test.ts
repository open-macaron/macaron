import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Ticket } from "@open-macaron/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MonthlyCapService } from "../../src/accounts/monthly-cap.service.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { ledger, users } from "../../src/db/schema.ts";
import { RunsRepository } from "../../src/runs/runs.repository.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext } from "../support/fixtures.ts";
import { startPostgres } from "../support/postgres.ts";

const SETTINGS = "https://macaron.example.test/settings/key";
const clock = new FakeClock(new Date("2026-10-23T12:00:00Z"));
let container: StartedPostgreSqlContainer;
let db: Db;
let runs: RunsRepository;
let caps: MonthlyCapService;
let next = 0;

/** A run billed to `payerId`, settled at `costUsd` on `at`, or still running when `costUsd` is undefined. */
async function run(payerId: string, limitUsd: number, costUsd?: number, at: Date = clock.now()): Promise<void> {
  next += 1;
  const thread = await runs.thread("org-x/repo-a", 3000 + next, "issue");
  const created = await runs.createRun({
    threadId: thread.id,
    ticket: Ticket.parse(`t_${String(next).padStart(43, "5")}`),
    mode: "plan",
    harness: "claude",
    model: "claude-sonnet-5-5",
    fastModel: "claude-haiku-4-5",
    context: runContext(),
    route: { mode: "plan", subject: { kind: "issue", number: 3000 + next }, checkout: { from: "defaultBranch" }, branch: `macaron/${String(3000 + next)}-plan` },
    limitMicros: Math.round(limitUsd * 1_000_000),
    triggerGithubId: 21,
    payerId,
  });
  if (costUsd === undefined) return;
  await runs.settle(created.id, Math.round(costUsd * 1_000_000), { repo: "org-x/repo-a", project: "sandbox" }, at);
  // The ledger stamps entries with the database's time: back-date this one.
  await db.update(ledger).set({ at }).where(eq(ledger.runId, created.id));
}

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await db.insert(users).values([
    { id: "alice", name: "Alice", email: "alice@example.test", githubId: 21, githubLogin: "alice" },
    { id: "bob", name: "Bob", email: "bob@example.test", githubId: 22, githubLogin: "bob" },
  ]);
  runs = new RunsRepository(db);
  caps = new MonthlyCapService(db, runs, clock);
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

describe("MonthlyCapService", () => {
  it("has no cap until the user sets one", async () => {
    expect(await caps.month("alice")).toEqual({ monthlyCapUsd: null, spentUsd: 0, reservedUsd: 0 });
    expect(await caps.refusal("alice", 5_000_000, SETTINGS)).toBeUndefined();
  });

  it("counts this month's settled runs billed to the user, and their runs still running", async () => {
    await run("alice", 1, 0.75);
    await run("alice", 1, 3, new Date("2026-09-30T23:00:00Z"));
    await run("alice", 2);
    await run("bob", 1, 9);
    expect(await caps.month("alice")).toEqual({ monthlyCapUsd: null, spentUsd: 0.75, reservedUsd: 2 });
  });

  it("refuses a run that could pass the cap, until it is raised or cleared", async () => {
    expect(await caps.set("alice", 5)).toEqual({ monthlyCapUsd: 5, spentUsd: 0.75, reservedUsd: 2 });
    expect(await caps.refusal("alice", 2_000_000, SETTINGS)).toBeUndefined();
    expect(await caps.refusal("alice", 2_500_000, SETTINGS)).toMatch(/your monthly cap of \$5\.00 has \$2\.25 left/);
    await caps.set("alice", 10);
    expect(await caps.refusal("alice", 2_500_000, SETTINGS)).toBeUndefined();
    await caps.set("alice", null);
    expect((await caps.month("alice")).monthlyCapUsd).toBeNull();
  });

  it("is per user", async () => {
    await caps.set("bob", 1);
    expect(await caps.refusal("bob", 100_000, SETTINGS)).toMatch(/has \$0\.00 left/);
    expect(await caps.refusal("alice", 100_000, SETTINGS)).toBeUndefined();
  });
});
