import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { MyMonth } from "@open-macaron/contracts";
import { eq } from "drizzle-orm";
import { Clock } from "../common/clock.ts";
import { toMicros, toUsd, type UsdMicros } from "../common/money.ts";
import { formatTokens } from "../common/tokens.ts";
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

/**
 * Why a run on free models of up to `limit` tokens would pass its payer's token cap, or undefined:
 * the same rule as dollars, over the tokens of their runs on free models.
 */
export function tokenCapRefusal(cap: number | null, used: number, reserved: number, limit: number, settings: string): string | undefined {
  if (cap === null || used + reserved + limit <= cap) return undefined;
  const left = Math.max(0, cap - used - reserved);
  return `this run may use up to ${formatTokens(limit)} tokens, and your monthly token cap of ${formatTokens(cap)} has ${formatTokens(left)} left: raise it on macaron (${settings}), or wait for next month`;
}

/** Each user's monthly caps: on what their key is billed, and on the tokens of their runs on free models. */
@Injectable()
export class MonthlyCapService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly runs: RunsRepository,
    private readonly clock: Clock,
  ) {}

  async month(userId: string): Promise<MyMonth> {
    const since = monthStart(this.clock.now());
    const [caps, spent, reserved, tokensUsed, tokensReserved] = await Promise.all([
      this.caps(userId),
      this.runs.spentByPayerSince(userId, since),
      this.runs.reservedMicros({ payerId: userId }),
      this.runs.tokensByPayerSince(userId, since),
      this.runs.reservedTokens(userId),
    ]);
    return { monthlyCapUsd: caps.usd === null ? null : toUsd(caps.usd), spentUsd: toUsd(spent), reservedUsd: toUsd(reserved), monthlyTokenCap: caps.tokens, tokensUsed, tokensReserved };
  }

  async set(userId: string, monthlyCapUsd: number | null): Promise<MyMonth> {
    await this.db
      .update(users)
      .set({ monthlyCapMicros: monthlyCapUsd === null ? null : toMicros(monthlyCapUsd), updatedAt: this.clock.now() })
      .where(eq(users.id, userId));
    return this.month(userId);
  }

  async setTokens(userId: string, monthlyTokenCap: number | null): Promise<MyMonth> {
    await this.db.update(users).set({ monthlyTokenCap, updatedAt: this.clock.now() }).where(eq(users.id, userId));
    return this.month(userId);
  }

  /** Why the payer's cap refuses a run of up to `limit`, or undefined. */
  async refusal(payerId: string, limit: UsdMicros, settings: string): Promise<string | undefined> {
    const cap = (await this.caps(payerId)).usd;
    if (cap === null) return undefined;
    const [spent, reserved] = await Promise.all([this.runs.spentByPayerSince(payerId, monthStart(this.clock.now())), this.runs.reservedMicros({ payerId })]);
    return capRefusal(cap, spent, reserved, limit, settings);
  }

  /** Why the payer's token cap refuses a run on free models of up to `limit` tokens, or undefined. */
  async tokenRefusal(payerId: string, limit: number, settings: string): Promise<string | undefined> {
    const cap = (await this.caps(payerId)).tokens;
    if (cap === null) return undefined;
    const [used, reserved] = await Promise.all([this.runs.tokensByPayerSince(payerId, monthStart(this.clock.now())), this.runs.reservedTokens(payerId)]);
    return tokenCapRefusal(cap, used, reserved, limit, settings);
  }

  private async caps(userId: string): Promise<{ readonly usd: UsdMicros | null; readonly tokens: number | null }> {
    const [row] = await this.db.select({ usd: users.monthlyCapMicros, tokens: users.monthlyTokenCap }).from(users).where(eq(users.id, userId));
    return { usd: row?.usd ?? null, tokens: row?.tokens ?? null };
  }
}
