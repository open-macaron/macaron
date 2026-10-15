import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/db.module.ts";
import { events } from "../db/schema.ts";

export type EventRecord = typeof events.$inferSelect;

export interface NewEvent {
  readonly threadId: string;
  /** `issue-comment:<id>`, `review-comment:<id>` or `issue:<number>`: unique per thread. */
  readonly externalId: string;
  readonly author: string;
  readonly kind: "mention" | "review" | "comment";
  readonly url: string;
  readonly body: string;
}

/** A thread is processed once nothing new has arrived on it for this long (one review = one run). */
export const QUIET_PERIOD_MS = 60_000;

@Injectable()
export class EventsRepository {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  /** Records an event; false if it was already known (the same comment seen by two polls). */
  async add(event: NewEvent): Promise<boolean> {
    const [inserted] = await this.db.insert(events).values(event).onConflictDoNothing().returning({ id: events.id });
    return inserted !== undefined;
  }

  async pending(threadId: string): Promise<EventRecord[]> {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.threadId, threadId), eq(events.status, "pending")))
      .orderBy(events.createdAt);
  }

  async settle(ids: readonly string[], status: "done" | "dropped"): Promise<void> {
    if (ids.length > 0) await this.db.update(events).set({ status }).where(inArray(events.id, [...ids]));
  }
}
