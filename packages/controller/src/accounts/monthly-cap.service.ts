import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { MyMonth } from "@open-macaron/contracts";
import { eq } from "drizzle-orm";
import { Clock } from "../common/clock.ts";
import { toMicros, toUsd, type UsdMicros } from "../common/money.ts";
import type { Db } from "../db/db.module.ts";
import { users } from "../db/schema.ts";
import { RunsRepository } from "../runs/runs.repository.ts";

/** This calendar month's start, in UTC: when caps start again. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const usd = (micros: UsdMicros): string => `$${toUsd(micros).toFixed(2)}`;

/**
 * Why a run of up to `limit` would pass its payer's cap, or undefined: what the month was billed,
 * plus the limits of runs not settled yet, plus this run's limit, must stay within the cap.
 */
export function capRefusal(cap: UsdMicros | null, spent: UsdMicros, reserved: UsdMicros, limit: UsdMicros, settings: string): string | undefined {
  if (cap === null || spent + reserved + limit <= cap) return undefined;
  const left = Math.max(0, cap - spent - reserved);
  return `this run may cost up to ${usd(limit)}, and your monthly cap of ${usd(cap)} has ${usd(left)} left: raise it on macaron (${settings}), or wait for next month`;
}

/** Each user's monthly cap on what their key is billed. */
@Injectable()
export class MonthlyCapService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly runs: RunsRepository,
    private readonly clock: Clock,
  ) {}

  async month(userId: string): Promise<MyMonth> {
    const [cap, spent, reserved] = await Promise.all([this.cap(userId), this.runs.spentByPayerSince(userId, monthStart(this.clock.now())), this.runs.reservedMicros({ payerId: userId })]);
    return { monthlyCapUsd: cap === null ? null : toUsd(cap), spentUsd: toUsd(spent), reservedUsd: toUsd(reserved) };
  }

  async set(userId: string, monthlyCapUsd: number | null): Promise<MyMonth> {
    await this.db
      .update(users)
      .set({ monthlyCapMicros: monthlyCapUsd === null ? null : toMicros(monthlyCapUsd), updatedAt: this.clock.now() })
      .where(eq(users.id, userId));
    return this.month(userId);
  }

  /** Why the payer's cap refuses a run of up to `limit`, or undefined. */
  async refusal(payerId: string, limit: UsdMicros, settings: string): Promise<string | undefined> {
    const cap = await this.cap(payerId);
    if (cap === null) return undefined;
    const [spent, reserved] = await Promise.all([this.runs.spentByPayerSince(payerId, monthStart(this.clock.now())), this.runs.reservedMicros({ payerId })]);
    return capRefusal(cap, spent, reserved, limit, settings);
  }

  private async cap(userId: string): Promise<UsdMicros | null> {
    const [row] = await this.db.select({ cap: users.monthlyCapMicros }).from(users).where(eq(users.id, userId));
    return row?.cap ?? null;
  }
}
