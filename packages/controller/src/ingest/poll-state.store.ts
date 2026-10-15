import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Db } from "../db/db.module.ts";
import { pollState } from "../db/schema.ts";
import type { PollState } from "./poll-policy.ts";

/** Persistence of the poller's pacing; abstract so the poller can be tested without a database. */
export abstract class PollStateStore {
  abstract load(): Promise<PollState | undefined>;
  abstract save(state: PollState): Promise<void>;
}

@Injectable()
export class DrizzlePollStateStore extends PollStateStore {
  constructor(@InjectDrizzle() private readonly db: Db) {
    super();
  }

  override async load(): Promise<PollState | undefined> {
    const [row] = await this.db.select().from(pollState).where(eq(pollState.id, 1));
    return row === undefined
      ? undefined
      : {
          lastModified: row.lastModified,
          intervalSec: row.intervalSec,
          notBefore: row.notBefore,
          consecutiveErrors: row.consecutiveErrors,
        };
  }

  override async save(state: PollState): Promise<void> {
    const values = {
      lastModified: state.lastModified,
      intervalSec: state.intervalSec,
      notBefore: state.notBefore,
      consecutiveErrors: state.consecutiveErrors,
    };
    await this.db
      .insert(pollState)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: pollState.id, set: values });
  }
}
