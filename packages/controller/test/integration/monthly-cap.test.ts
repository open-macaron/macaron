import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { DEFAULT_MONTHLY_TOKEN_CAP, Ticket } from "@open-macaron/contracts";
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
/** A user who never touched their token cap, with no run on free models. */
const DEFAULT_TOKENS = { monthlyTokenCap: DEFAULT_MONTHLY_TOKEN_CAP, tokensUsed: 0, tokensReserved: 0 };
const clock = new FakeClock(new Date("2026-10-23T12:00:00Z"));
let container: StartedPostgreSqlContainer;
let db: Db;
let runs: RunsRepository;
let caps: MonthlyCapService;
let next = 0;

/**
 * A run billed to `payerId`, settled at `costUsd` on `at`, or still running when `costUsd` is
 * undefined; on free models when it has `tokens` (its ceiling, and what it used once settled).
 */
async function run(payerId: string, limitUsd: number, costUsd?: number, at: Date = clock.now(), tokens?: { limit: number; used: number }): Promise<void> {
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
    tokenLimit: tokens?.limit,
    triggerGithubId: 21,
    payerId,
  });
  if (costUsd === undefined) return;
  await runs.settle(created.id, Math.round(costUsd * 1_000_000), { repo: "org-x/repo-a", project: "sandbox" }, at, tokens?.used ?? null);
  // The ledger stamps entries with the database's time: back-date this one.
  await db.update(ledger).set({ at }).where(eq(ledger.runId, created.id));
}

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await db.insert(users).values([
    { id: "alice", name: "Alice", email: "alice@example.test", githubId: 21, githubLogin: "alice" },
    { id: "bob", name: "Bob", email: "bob@example.test", githubId: 22, githubLogin: "bob" },
    { id: "carol", name: "Carol", email: "carol@example.test", githubId: 23, githubLogin: "carol" },
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
    expect(await caps.month("alice")).toEqual({ monthlyCapUsd: null, spentUsd: 0, reservedUsd: 0, ...DEFAULT_TOKENS });
    expect(await caps.refusal("alice", 5_000_000, SETTINGS)).toBeUndefined();
  });

  it("counts this month's settled runs billed to the user, and their runs still running", async () => {
    await run("alice", 1, 0.75);
    await run("alice", 1, 3, new Date("2026-09-30T23:00:00Z"));
    await run("alice", 2);
    await run("bob", 1, 9);
    expect(await caps.month("alice")).toEqual({ monthlyCapUsd: null, spentUsd: 0.75, reservedUsd: 2, ...DEFAULT_TOKENS });
  });

  it("refuses a run that could pass the cap, until it is raised or cleared", async () => {
    expect(await caps.set("alice", 5)).toEqual({ monthlyCapUsd: 5, spentUsd: 0.75, reservedUsd: 2, ...DEFAULT_TOKENS });
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

  it("counts the tokens of this month's settled runs on free models, and reserves the ceilings of those still running", async () => {
    const free = (limit: number, used: number) => ({ limit, used });
    await run("carol", 5, 0, clock.now(), free(50_000_000, 30_000_000));
    await run("carol", 5, 0, new Date("2026-09-30T23:00:00Z"), free(50_000_000, 45_000_000));
    await run("carol", 5, undefined, clock.now(), free(50_000_000, 0));
    // A paid run's tokens are recorded too, but its dollars bound it: they don't count here.
    await run("carol", 1, 0.5);
    expect(await caps.month("carol")).toMatchObject({ monthlyTokenCap: DEFAULT_MONTHLY_TOKEN_CAP, tokensUsed: 30_000_000, tokensReserved: 50_000_000 });
  });

  it("refuses a run on free models that could pass the token cap, until it is raised or cleared", async () => {
    // 30M used and 50M reserved: a 50M run fits 130M, not 100M.
    expect(await caps.tokenRefusal("carol", 50_000_000, SETTINGS)).toBeUndefined();
    expect(await caps.setTokens("carol", 100_000_000)).toMatchObject({ monthlyTokenCap: 100_000_000 });
    expect(await caps.tokenRefusal("carol", 50_000_000, SETTINGS)).toBe(
      `this run may use up to 50M tokens, and your monthly token cap of 100M has 20M left: raise it on macaron (${SETTINGS}), or wait for next month`,
    );
    await caps.setTokens("carol", null);
    expect(await caps.tokenRefusal("carol", 50_000_000, SETTINGS)).toBeUndefined();
    expect((await caps.month("carol")).monthlyTokenCap).toBeNull();
  });
});
