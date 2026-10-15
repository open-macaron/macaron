import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { describeError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";

/** Every queue the controller uses, with its pg-boss policy. */
export const Queue = {
  /** GET /notifications, one at a time across instances, self-scheduled at X-Poll-Interval. */
  pollNotifications: "poll-notifications",
  /** One job per thread that has new triggers; `stately` = at most one queued and one active per thread. */
  threadReady: "thread-ready",
  /** A workflow run finished (webhook or reconcile); one job per run, whoever saw it first. */
  runCompleted: "run-completed",
  /** A finished run's final cost, read ~90 s later (OpenRouter reports usage asynchronously). */
  settleCost: "settle-cost",
  /** Periodic: recover workflow_run completions missed during a restart, enforce timeouts. */
  reconcile: "reconcile",
  /** Periodic: delete leftover `macaron-run-*` OpenRouter keys. */
  sweepKeys: "sweep-keys",
} as const;
export type QueueName = (typeof Queue)[keyof typeof Queue];

const POLL_KEY = "poll";

export const ThreadReadyJob = z.object({ threadId: z.uuid() });
export const NoPayload = z.unknown();
export const SettleCostJob = z.object({ runId: z.uuid(), previousMicros: z.int().nonnegative().optional() });
export const RunCompletedJob = z.object({ ghRunId: z.int().positive(), conclusion: z.string().nullable() });

/**
 * pg-boss, on the same Postgres. It creates and migrates its own `pgboss` schema at startup.
 * Handlers validate their payloads: a job's data is just JSON read back from the database.
 */
@Injectable()
export class Jobs implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(Jobs.name);
  private readonly boss: PgBoss;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss", application_name: "macaron-controller" });
    this.boss.on("error", (error: unknown) => {
      this.logger.error(`pg-boss: ${describeError(error)}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(Queue.pollNotifications, { policy: "stately", retryLimit: 0, expireInSeconds: 120 });
    await this.boss.createQueue(Queue.threadReady, { policy: "stately", retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 });
    await this.boss.createQueue(Queue.runCompleted, { policy: "short", retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 });
    await this.boss.createQueue(Queue.settleCost, { policy: "short", retryLimit: 10, retryDelay: 60, retryBackoff: true, expireInSeconds: 600 });
    await this.boss.createQueue(Queue.reconcile, { policy: "singleton", expireInSeconds: 300 });
    await this.boss.createQueue(Queue.sweepKeys, { policy: "singleton", expireInSeconds: 300 });
    await this.boss.schedule(Queue.reconcile, "*/2 * * * *");
    await this.boss.schedule(Queue.sweepKeys, "17 * * * *");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }

  /**
   * Debounce: the thread is processed once nothing new arrived for `quietMs`. `upsert` moves the
   * thread's pending job back (or creates it), so a burst of comments is one job; a job already
   * running is left alone and the burst queues behind it.
   */
  async threadReady(threadId: string, quietMs: number): Promise<void> {
    await this.boss.upsert(Queue.threadReady, { threadId }, { singletonKey: threadId, startAfter: new Date(Date.now() + quietMs) });
  }

  /** The next notifications poll, at exactly `at` (moves the pending one if there is one). */
  async pollAt(at: Date): Promise<void> {
    await this.boss.upsert(Queue.pollNotifications, {}, { singletonKey: POLL_KEY, startAfter: at });
  }

  /** Safety net: makes sure a poll is always pending, without moving one that already is. */
  async keepPolling(): Promise<void> {
    await this.boss.schedule(Queue.pollNotifications, "* * * * *", {}, { singletonKey: POLL_KEY });
  }

  /** Deduplicated by run id: the webhook and reconcile may both report the same completion. */
  async runCompleted(ghRunId: number, conclusion: string | null): Promise<void> {
    await this.boss.send(Queue.runCompleted, { ghRunId, conclusion }, { singletonKey: String(ghRunId) });
  }

  /** Settles a run's cost after `delayMs`; deduplicated by run id. */
  async settleCost(runId: string, delayMs: number, previousMicros?: number): Promise<void> {
    const data = previousMicros === undefined ? { runId } : { runId, previousMicros };
    await this.boss.send(Queue.settleCost, data, { singletonKey: runId, startAfter: new Date(Date.now() + delayMs) });
  }

  /** Registers a handler; the payload is validated with `schema` before `handle` sees it. */
  async work<T>(queue: QueueName, schema: z.ZodType<T>, handle: (data: T) => Promise<void>): Promise<void> {
    await this.boss.work(queue, async (jobs) => {
      for (const job of jobs) await handle(schema.parse(job.data));
    });
  }
}
