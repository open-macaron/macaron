import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { UsagePage } from "@open-macaron/contracts";
import { and, count, desc, eq, gte, isNotNull, lt, or, sum } from "drizzle-orm";
import { Clock } from "../common/clock.ts";
import { toUsd } from "../common/money.ts";
import type { Db } from "../db/db.module.ts";
import { runs, threads } from "../db/schema.ts";

/** `<ISO date>|<run id>`, base64url: where the next page starts (newest first). */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { readonly createdAt: Date; readonly id: string } | undefined {
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(at ?? "");
  return id === undefined || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id) ? undefined : { createdAt, id };
}

/** The runs a user asked for, and what they cost. */
@Injectable()
export class UsageService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async page(githubId: number, limit: number, before: string | undefined): Promise<UsagePage> {
    const cursor = before === undefined ? undefined : decodeCursor(before);
    const mine = eq(runs.triggerGithubId, githubId);
    const after = cursor === undefined ? undefined : or(lt(runs.createdAt, cursor.createdAt), and(eq(runs.createdAt, cursor.createdAt), lt(runs.id, cursor.id)));
    const rows = await this.db
      .select({ run: runs, repo: threads.repo, number: threads.number, kind: threads.kind })
      .from(runs)
      .innerJoin(threads, eq(threads.id, runs.threadId))
      .where(after === undefined ? mine : and(mine, after))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    const now = this.clock.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [month] = await this.db
      .select({ micros: sum(runs.costMicros).mapWith(Number), runs: count() })
      .from(runs)
      .where(and(mine, gte(runs.createdAt, monthStart), isNotNull(runs.settledAt)));

    return {
      runs: page.map(({ run, repo, number, kind }) => ({
        id: run.id,
        repo,
        number,
        kind,
        mode: run.mode,
        status: run.status,
        model: run.model,
        costUsd: run.costMicros === null ? null : toUsd(run.costMicros),
        createdAt: run.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.run.createdAt, last.run.id) : null,
      monthUsd: toUsd(month?.micros ?? 0),
      monthRuns: month?.runs ?? 0,
    };
  }
}
