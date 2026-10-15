import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Harness, Mode, RunContext, Ticket } from "@open-macaron/contracts";
import { and, count, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { TicketAlreadyRedeemed, TicketRejected } from "../common/errors.ts";
import type { UsdMicros } from "../common/money.ts";
import type { Db } from "../db/db.module.ts";
import { effects, ledger, runs, threads } from "../db/schema.ts";

export type ThreadRecord = typeof threads.$inferSelect;
export type RunRecord = typeof runs.$inferSelect;
export type RunStatus = RunRecord["status"];

export const ACTIVE_STATUSES: readonly RunStatus[] = ["pending", "dispatched", "running"];

export interface NewRun {
  readonly threadId: string;
  readonly ticket: Ticket;
  readonly mode: Mode;
  readonly harness: Harness;
  readonly model: string;
  readonly context: RunContext;
  readonly limitMicros: UsdMicros;
}

export interface Redemption {
  readonly key: string;
  readonly run: RunRecord;
}

/** Thrown by redeem() while the dispatch response (and thus the run id) isn't recorded yet. */
export class RunNotBoundYet extends Error {
  constructor() {
    super("run is not bound to a workflow run yet");
    this.name = "RunNotBoundYet";
  }
}

const sumMicros = sql<number>`coalesce(sum(${ledger.usdMicros}), 0)`.mapWith(Number);

@Injectable()
export class RunsRepository {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  async thread(repo: string, number: number, kind: ThreadRecord["kind"]): Promise<ThreadRecord> {
    const [created] = await this.db.insert(threads).values({ repo, number, kind }).onConflictDoNothing().returning();
    if (created !== undefined) return created;
    const [existing] = await this.db.select().from(threads).where(and(eq(threads.repo, repo), eq(threads.number, number)));
    if (existing === undefined) throw new Error(`thread ${repo}#${String(number)} vanished`);
    return existing;
  }

  async threadById(id: string): Promise<ThreadRecord> {
    const [thread] = await this.db.select().from(threads).where(eq(threads.id, id));
    if (thread === undefined) throw new Error(`unknown thread ${id}`);
    return thread;
  }

  /** The thread an upstream PR belongs to (the bot's own PRs), if any. */
  async threadByPull(repo: string, prNumber: number): Promise<ThreadRecord | undefined> {
    const [thread] = await this.db.select().from(threads).where(and(eq(threads.repo, repo), eq(threads.prNumber, prNumber)));
    return thread;
  }

  async updateThread(id: string, patch: Partial<Pick<ThreadRecord, "branch" | "prNumber" | "statusCommentId" | "prStatusCommentId">>): Promise<void> {
    await this.db.update(threads).set(patch).where(eq(threads.id, id));
  }

  /** Creates the run as the thread's next loop, atomically. */
  async createRun(run: NewRun): Promise<RunRecord> {
    return this.db.transaction(async (tx) => {
      const [thread] = await tx
        .update(threads)
        .set({ loops: sql`${threads.loops} + 1` })
        .where(eq(threads.id, run.threadId))
        .returning({ loops: threads.loops });
      if (thread === undefined) throw new Error(`unknown thread ${run.threadId}`);
      // Explicit columns: a caller passing a wider object must never write extra fields.
      const [created] = await tx
        .insert(runs)
        .values({
          threadId: run.threadId,
          ticket: run.ticket,
          mode: run.mode,
          harness: run.harness,
          model: run.model,
          context: run.context,
          limitMicros: run.limitMicros,
          loop: thread.loops,
        })
        .returning();
      if (created === undefined) throw new Error("run insert returned nothing");
      return created;
    });
  }

  async attachKey(runId: string, hash: string, secret: string): Promise<void> {
    await this.db.update(runs).set({ keyHash: hash, keySecret: secret }).where(eq(runs.id, runId));
  }

  async markDispatched(runId: string, ghRunId: number): Promise<void> {
    await this.db.update(runs).set({ status: "dispatched", ghRunId }).where(eq(runs.id, runId));
  }

  /**
   * Hands out the run's key exactly once, and only to the workflow run it was dispatched as.
   * The key is wiped from the database in the same transaction.
   */
  async redeem(ticket: Ticket, ghRunId: number, now: Date): Promise<Redemption> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.ticket, ticket)).for("update");
      if (run === undefined) throw new TicketRejected("unknown ticket");
      if (run.redeemedAt !== null) throw new TicketAlreadyRedeemed("ticket already redeemed");
      if (run.ghRunId === null) throw new RunNotBoundYet();
      if (run.ghRunId !== ghRunId) throw new TicketRejected("ticket belongs to another workflow run");
      if (run.status !== "dispatched" || run.keySecret === null) throw new TicketRejected(`run is ${run.status}`);
      const [updated] = await tx
        .update(runs)
        .set({ status: "running", redeemedAt: now, keySecret: null })
        .where(eq(runs.id, run.id))
        .returning();
      if (updated === undefined) throw new Error("redeem update returned nothing");
      return { key: run.keySecret, run: updated };
    });
  }

  async byGhRunId(ghRunId: number): Promise<RunRecord | undefined> {
    const [run] = await this.db.select().from(runs).where(eq(runs.ghRunId, ghRunId));
    return run;
  }

  async byId(id: string): Promise<RunRecord> {
    const [run] = await this.db.select().from(runs).where(eq(runs.id, id));
    if (run === undefined) throw new Error(`unknown run ${id}`);
    return run;
  }

  /** Runs whose cost is not in the ledger yet (running, or finished and awaiting settlement). */
  async unsettled(): Promise<RunRecord[]> {
    return this.db.select().from(runs).where(isNull(runs.settledAt));
  }

  async active(): Promise<RunRecord[]> {
    return this.db.select().from(runs).where(inArray(runs.status, [...ACTIVE_STATUSES]));
  }

  /** Closes a run exactly once: false if it was already finished (webhook and reconcile racing). */
  async finish(runId: string, outcome: { status: "completed" | "failed" | "aborted"; failure: string | null }, now: Date): Promise<boolean> {
    const [closed] = await this.db
      .update(runs)
      .set({ status: outcome.status, failure: outcome.failure, finishedAt: now, keySecret: null })
      .where(and(eq(runs.id, runId), isNull(runs.finishedAt)))
      .returning({ id: runs.id });
    return closed !== undefined;
  }

  /** Records the run's final cost, once, in the run and in the append-only ledger. */
  async settle(runId: string, costMicros: UsdMicros, attribution: { repo: string; project: string }, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [settled] = await tx
        .update(runs)
        .set({ costMicros, settledAt: now })
        .where(and(eq(runs.id, runId), isNull(runs.settledAt)))
        .returning({ id: runs.id });
      if (settled === undefined) return false;
      await tx.insert(ledger).values({ kind: "run", runId, usdMicros: costMicros, ...attribution });
      return true;
    });
  }

  async recordRouterSpend(repo: string, project: string, usdMicros: UsdMicros): Promise<void> {
    await this.db.insert(ledger).values({ kind: "router", runId: null, repo, project, usdMicros });
  }

  async spentOnThread(threadId: string): Promise<UsdMicros> {
    const [row] = await this.db
      .select({ total: sumMicros })
      .from(ledger)
      .innerJoin(runs, eq(ledger.runId, runs.id))
      .where(eq(runs.threadId, threadId));
    return row?.total ?? 0;
  }

  async spentOnRepoSince(repo: string, since: Date): Promise<UsdMicros> {
    const [row] = await this.db.select({ total: sumMicros }).from(ledger).where(and(eq(ledger.repo, repo), gte(ledger.at, since)));
    return row?.total ?? 0;
  }

  async spentOnProjectSince(project: string, since: Date): Promise<UsdMicros> {
    const [row] = await this.db.select({ total: sumMicros }).from(ledger).where(and(eq(ledger.project, project), gte(ledger.at, since)));
    return row?.total ?? 0;
  }

  /** Limits of runs whose cost isn't settled yet: counted against caps so parallel runs can't overshoot. */
  async reservedMicros(filter: { repo?: string; threadId?: string }): Promise<UsdMicros> {
    const where = and(
      isNull(runs.settledAt),
      filter.repo === undefined ? undefined : eq(threads.repo, filter.repo),
      filter.threadId === undefined ? undefined : eq(runs.threadId, filter.threadId),
    );
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${runs.limitMicros}), 0)`.mapWith(Number) })
      .from(runs)
      .innerJoin(threads, eq(runs.threadId, threads.id))
      .where(where);
    return row?.total ?? 0;
  }

  async activeCount(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(runs).where(inArray(runs.status, [...ACTIVE_STATUSES]));
    return row?.n ?? 0;
  }

  /** Loops already run on a thread, with their cost, for the cost table and the agent's context. */
  async loops(threadId: string): Promise<RunRecord[]> {
    return this.db.select().from(runs).where(eq(runs.threadId, threadId)).orderBy(runs.loop);
  }

  /**
   * At-most-once external side effect. Claims (thread, loop, kind) first; if the claim exists the
   * effect already happened (or is happening) and `perform` is skipped.
   */
  async once<T extends number | string | null>(threadId: string, loop: number, kind: string, perform: () => Promise<T>): Promise<T | undefined> {
    const [claimed] = await this.db.insert(effects).values({ threadId, loop, kind }).onConflictDoNothing().returning({ id: effects.id });
    if (claimed === undefined) return undefined;
    const outcome = await perform();
    await this.db
      .update(effects)
      .set({ externalId: outcome === null ? null : String(outcome) })
      .where(eq(effects.id, claimed.id));
    return outcome;
  }

  async effect(threadId: string, loop: number, kind: string): Promise<string | null | undefined> {
    const [row] = await this.db
      .select({ externalId: effects.externalId })
      .from(effects)
      .where(and(eq(effects.threadId, threadId), eq(effects.loop, loop), eq(effects.kind, kind)));
    return row === undefined ? undefined : row.externalId;
  }

  /** The loop's recorded effects whose kind starts with `prefix` (a fixed string, no wildcards). */
  async effectsWithPrefix(threadId: string, loop: number, prefix: string): Promise<{ kind: string; externalId: string | null }[]> {
    return this.db
      .select({ kind: effects.kind, externalId: effects.externalId })
      .from(effects)
      .where(and(eq(effects.threadId, threadId), eq(effects.loop, loop), like(effects.kind, `${prefix}%`)));
  }
}
