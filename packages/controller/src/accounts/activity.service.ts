import { Inject, Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { AdminRefusalsPage, AdminRefusalsQuery, AdminRunsPage, AdminRunsQuery } from "@open-macaron/contracts";
import { and, desc, eq, gte, isNotNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Clock } from "../common/clock.ts";
import { decodeCursor, encodeCursor } from "../common/cursor.ts";
import { toUsd } from "../common/money.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import type { Db } from "../db/db.module.ts";
import { events, runs, threads, users } from "../db/schema.ts";
import { runUrl } from "../runs/run-url.ts";

/** Everything the bot was asked to do, by whom, and what it refused: the admins' activity page. */
@Injectable()
export class ActivityService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly clock: Clock,
  ) {}

  async runs(query: AdminRunsQuery): Promise<AdminRunsPage> {
    const filters = and(
      query.user === undefined ? undefined : eq(runs.triggerGithubId, query.user),
      query.repo === undefined ? undefined : eq(threads.repo, query.repo),
      query.status === undefined ? undefined : eq(runs.status, query.status),
      query.mode === undefined ? undefined : eq(runs.mode, query.mode),
    );
    const rows = await this.db
      .select({ run: runs, repo: threads.repo, number: threads.number, kind: threads.kind, prNumber: threads.prNumber, account: users })
      .from(runs)
      .innerJoin(threads, eq(threads.id, runs.threadId))
      .leftJoin(users, eq(users.githubId, runs.triggerGithubId))
      .where(and(filters, after(runs.createdAt, runs.id, query.before)))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    const [month] = await this.db
      .select({
        micros: sql`coalesce(sum(${runs.costMicros}) filter (where ${runs.settledAt} is not null), 0)`.mapWith(Number),
        runs: sql`count(*)`.mapWith(Number),
        failed: sql`count(*) filter (where ${runs.status} = 'failed')`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(threads, eq(threads.id, runs.threadId))
      .where(and(filters, gte(runs.createdAt, this.monthStart())));

    return {
      runs: page.map(({ run, repo, number, kind, prNumber, account }) => ({
        id: run.id,
        repo,
        number,
        kind,
        mode: run.mode,
        status: run.status,
        model: run.model,
        costUsd: run.costMicros === null ? null : toUsd(run.costMicros),
        createdAt: run.createdAt.toISOString(),
        asker: {
          githubId: run.triggerGithubId,
          // An account's login is current; the trigger's is the one the comment was written under.
          login: account?.githubLogin ?? run.context.trigger.author,
          name: account?.name ?? null,
          avatarUrl: account?.image ?? null,
          hasAccount: account !== null,
        },
        triggerUrl: run.context.trigger.url,
        instruction: run.context.trigger.instruction,
        runUrl: runUrl(this.env, run.ghRunId),
        prNumber,
        limitUsd: toUsd(run.limitMicros),
        failure: run.failure,
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.run.createdAt, last.run.id) : null,
      monthUsd: toUsd(month?.micros ?? 0),
      monthRuns: month?.runs ?? 0,
      monthFailed: month?.failed ?? 0,
    };
  }

  async refusals(query: AdminRefusalsQuery): Promise<AdminRefusalsPage> {
    // Refused before reasons were kept, or refused once and replayed by `retry` since.
    const refused = or(isNotNull(events.refusal), eq(events.status, "refused"));
    const rows = await this.db
      .select({ event: events, repo: threads.repo, number: threads.number })
      .from(events)
      .innerJoin(threads, eq(threads.id, events.threadId))
      .where(
        and(
          refused,
          query.user === undefined ? undefined : eq(events.authorId, query.user),
          query.repo === undefined ? undefined : eq(threads.repo, query.repo),
          after(events.createdAt, events.id, query.before),
        ),
      )
      .orderBy(desc(events.createdAt), desc(events.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      refusals: page.map(({ event, repo, number }) => ({
        id: event.id,
        repo,
        number,
        kind: event.subjectKind,
        author: event.author,
        authorId: event.authorId,
        url: event.url,
        reason: event.refusal,
        createdAt: event.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.event.createdAt, last.event.id) : null,
    };
  }

  private monthStart(): Date {
    const now = this.clock.now();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}

/** Rows strictly older than the cursor, newest-first keyset; everything without one. */
function after(createdAt: PgColumn, id: PgColumn, before: string | undefined): SQL | undefined {
  const cursor = before === undefined ? undefined : decodeCursor(before);
  return cursor === undefined ? undefined : or(lt(createdAt, cursor.at), and(eq(createdAt, cursor.at), lt(id, cursor.id)));
}
