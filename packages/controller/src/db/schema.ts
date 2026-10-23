import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { Capability, type RunContext } from "@open-macaron/contracts";
import { LlmBackend } from "../budget/run-keys.ts";
import type { Route } from "../routing/routes.ts";

/** Money is stored as integer micro-dollars: no floating point anywhere near a bill. */
const usdMicros = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const threadKind = pgEnum("thread_kind", ["issue", "pull"]);
export const eventStatus = pgEnum("event_status", ["pending", "done", "dropped"]);
export const runStatus = pgEnum("run_status", ["pending", "dispatched", "running", "completed", "failed", "aborted"]);
export const runMode = pgEnum("run_mode", ["triage", "plan", "implement", "address_review", "reproduce", "verify", "retro", "review"]);
export const ledgerKind = pgEnum("ledger_kind", ["run", "router"]);
export const llmBackend = pgEnum("llm_backend", LlmBackend.enum);
/** What a user may ask the bot for: one value per capability, appended by migrations, never renamed. */
export const capability = pgEnum("capability", Capability.enum);
export const userRole = pgEnum("user_role", ["user", "admin"]);
/** `expired` is written when a pending invitation past its date stands in the way of a new one. */
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "revoked", "expired"]);

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

/**
 * Every published configuration the controller applied, newest last: the boot fallback when Pages
 * is unreachable, and a record of which commit of open-macaron/config was live when.
 */
export const configSnapshots = pgTable(
  "config_snapshots",
  {
    commit: text("commit").primaryKey(),
    files: jsonb("files").$type<Record<string, string>>().notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("config_snapshots_applied_at").on(table.appliedAt)],
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
    /** No longer written: each loop has its own status comment (effect `status`). Kept for history. */
    statusCommentId: bigint("status_comment_id", { mode: "number" }),
    /** No longer written: see statusCommentId. */
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
    /** What the notification was about: the issue, or a pull request (the bot's own or not). */
    subjectKind: threadKind("subject_kind").notNull(),
    subjectNumber: integer("subject_number").notNull(),
    author: text("author").notNull(),
    /** The author's immutable GitHub id: whose capabilities and key a run uses. Null before this column existed. */
    authorId: bigint("author_id", { mode: "number" }),
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
    /** The harness's background model, fixed at launch like `model`: the run's key allows only these two. Null before this column existed. */
    fastModel: text("fast_model"),
    context: jsonb("context").$type<RunContext>().notNull(),
    /** What the run was routed to do: where it answers, what it checked out. Null before this column existed. */
    route: jsonb("route").$type<Route>(),
    /** Where the run's key was minted; set together with key_hash. */
    keyBackend: llmBackend("key_backend"),
    keyHash: text("key_hash"),
    /** The run's LLM key, held only until the ticket is redeemed, then wiped. */
    keySecret: text("key_secret"),
    limitMicros: usdMicros("limit_micros").notNull(),
    costMicros: usdMicros("cost_micros"),
    /** GitHub id of the user who asked for the run (retries and escalations keep it). Null for runs before this column existed. */
    triggerGithubId: bigint("trigger_github_id", { mode: "number" }),
    ghRunId: bigint("gh_run_id", { mode: "number" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Set once the key's final usage is in the ledger (backends report usage some seconds late). */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    failure: text("failure"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("runs_ticket").on(table.ticket),
    uniqueIndex("runs_gh_run").on(table.ghRunId),
    uniqueIndex("runs_thread_loop").on(table.threadId, table.loop),
    index("runs_status").on(table.status),
    index("runs_trigger_created").on(table.triggerGithubId, table.createdAt),
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

// Users and sessions: better-auth's tables (packages/controller/src/auth/auth.ts), hand-owned here.
// Field names are better-auth's; the adapter maps them to these columns.

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** A person who signed in with GitHub. Only invited GitHub ids (or the operator's admins) can become one. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Written when the GitHub account is linked, in the same request as the user's creation. */
  githubId: bigint("github_id", { mode: "number" }).unique(),
  githubLogin: text("github_login"),
  role: userRole("role").notNull().default("user"),
  /** Granted by an admin: at invitation, then on the Users page. Never set through better-auth. */
  capabilities: capability("capabilities").array().notNull().default(sql`'{}'::capability[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("sessions_user").on(table.userId)],
);

/** The GitHub account behind a user. Its OAuth tokens are never stored (auth.ts drops them). */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("accounts_user").on(table.userId), uniqueIndex("accounts_provider_account").on(table.providerId, table.accountId)],
);

/** better-auth's short-lived values: the OAuth state of a sign-in in progress. */
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier").on(table.identifier)],
);

/** Who may create an account: a GitHub id, resolved from the login when invited, and what they may ask for. */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    githubLogin: text("github_login").notNull(),
    capabilities: capability("capabilities").array().notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: invitationStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // At most one pending invitation per GitHub account.
    uniqueIndex("invitations_pending_github").on(table.githubId).where(sql`${table.status} = 'pending'`),
    index("invitations_created").on(table.createdAt),
  ],
);

/** Append-only record of what admins changed: invitations, capabilities. */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    target: text("target").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    at: createdAt(),
  },
  (table) => [index("admin_audit_at").on(table.at)],
);

/**
 * LLM endpoints an administrator approved: users' keys are only ever sent there. The base URL is
 * unique and never updated (no route changes it): disabling one and approving another is the only
 * way to move, so a saved key can't be redirected to a new host.
 */
export const llmEndpoints = pgTable("llm_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  pricingNote: text("pricing_note"),
  /** Null for the deployment's defaults (LLM_ENDPOINT_DEFAULTS). */
  createdBy: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
