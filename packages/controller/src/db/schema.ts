import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RunContext } from "@open-macaron/contracts";

/** Money is stored as integer micro-dollars: no floating point anywhere near a bill. */
const usdMicros = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const threadKind = pgEnum("thread_kind", ["issue", "pull"]);
export const eventStatus = pgEnum("event_status", ["pending", "done", "dropped"]);
export const runStatus = pgEnum("run_status", ["pending", "dispatched", "running", "completed", "failed", "aborted"]);
export const runMode = pgEnum("run_mode", ["triage", "plan", "implement", "address_review", "reproduce", "verify", "retro"]);
export const ledgerKind = pgEnum("ledger_kind", ["run", "router"]);

/** Singleton row (id = 1): the notifications poller's state. Persisted so restarts never poll early. */
export const pollState = pgTable(
  "poll_state",
  {
    id: integer("id").primaryKey(),
    lastModified: text("last_modified"),
    intervalSec: integer("interval_sec").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  },
  (table) => [check("poll_state_singleton", sql`${table.id} = 1`)],
);

/** An upstream issue (and the PR the bot opened for it, if any). */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    kind: threadKind("kind").notNull(),
    branch: text("branch"),
    prNumber: integer("pr_number"),
    loops: integer("loops").notNull().default(0),
    /** The sticky status comment on the issue, used until the bot's PR exists. */
    statusCommentId: bigint("status_comment_id", { mode: "number" }),
    /** The sticky status comment on the bot's PR, used for every loop after it was opened. */
    prStatusCommentId: bigint("pr_status_comment_id", { mode: "number" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("threads_repo_number").on(table.repo, table.number),
    index("threads_repo_pr").on(table.repo, table.prNumber),
  ],
);

/** A trigger seen on a thread. Dedupes notifications; pg-boss schedules the thread's processing. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    author: text("author").notNull(),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    body: text("body").notNull(),
    status: eventStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("events_thread_external").on(table.threadId, table.externalId),
    index("events_thread_status").on(table.threadId, table.status),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticket: text("ticket").notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "restrict" }),
    loop: integer("loop").notNull(),
    mode: runMode("mode").notNull(),
    status: runStatus("status").notNull().default("pending"),
    harness: text("harness").notNull(),
    model: text("model").notNull(),
    context: jsonb("context").$type<RunContext>().notNull(),
    keyHash: text("key_hash"),
    /** The run's OpenRouter key, held only until the ticket is redeemed, then wiped. */
    keySecret: text("key_secret"),
    limitMicros: usdMicros("limit_micros").notNull(),
    costMicros: usdMicros("cost_micros"),
    ghRunId: bigint("gh_run_id", { mode: "number" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Set once the key's final usage is in the ledger (OpenRouter reports usage ~25 s late). */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    failure: text("failure"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("runs_ticket").on(table.ticket),
    uniqueIndex("runs_gh_run").on(table.ghRunId),
    uniqueIndex("runs_thread_loop").on(table.threadId, table.loop),
    index("runs_status").on(table.status),
  ],
);

/** Append-only record of money spent. */
export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: ledgerKind("kind").notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "restrict" }),
    repo: text("repo").notNull(),
    project: text("project").notNull(),
    usdMicros: usdMicros("usd_micros").notNull(),
    at: createdAt(),
  },
  (table) => [index("ledger_repo_at").on(table.repo, table.at), index("ledger_project_at").on(table.project, table.at)],
);

/** Idempotency keys for external side effects: a retried job never posts twice. */
export const effects = pgTable(
  "effects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull(),
    kind: text("kind").notNull(),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("effects_thread_loop_kind").on(table.threadId, table.loop, table.kind)],
);
