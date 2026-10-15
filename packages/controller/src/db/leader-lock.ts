import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { PoolClient } from "pg";
import { z } from "zod";
import { describeError } from "../common/errors.ts";
import type { Db } from "./db.module.ts";

/** Advisory lock keys. One per singleton role; never reuse a value. */
export const LockKey = {
  notificationsPoller: 7_207_001,
  keySweeper: 7_207_002,
} as const satisfies Record<string, number>;
export type LockKey = (typeof LockKey)[keyof typeof LockKey];

const LockRow = z.object({ acquired: z.boolean() });

/** "Am I the one instance allowed to do X?" — abstract so callers can be tested without Postgres. */
export abstract class LeaderLock {
  /** True if this process holds `key` (acquiring it if free). Re-entrant, cheap to call every tick. */
  abstract holds(key: LockKey): Promise<boolean>;
}

/**
 * Session-level Postgres advisory locks on one dedicated connection. If that connection
 * drops, every lock is released by Postgres and re-acquired on the next call.
 */
@Injectable()
export class PostgresLeaderLock extends LeaderLock implements OnApplicationShutdown {
  private readonly logger = new Logger(PostgresLeaderLock.name);
  private client: PoolClient | undefined;

  constructor(@InjectDrizzle() private readonly db: Db) {
    super();
  }

  override async holds(key: LockKey): Promise<boolean> {
    try {
      const client = await this.connection();
      const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [key]);
      return LockRow.parse(result.rows[0]).acquired;
    } catch (error: unknown) {
      this.logger.warn(`advisory lock ${String(key)} unavailable: ${describeError(error)}`);
      this.release();
      return false;
    }
  }

  onApplicationShutdown(): void {
    this.release();
  }

  private async connection(): Promise<PoolClient> {
    if (this.client !== undefined) return this.client;
    const client = await this.db.$client.connect();
    client.on("error", () => {
      this.release();
    });
    this.client = client;
    return client;
  }

  /** Destroys the session, which releases its advisory locks server-side. */
  private release(): void {
    this.client?.release(true);
    this.client = undefined;
  }
}
