import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { CommitSha, type PublishedConfig } from "@open-macaron/contracts";
import { desc, sql } from "drizzle-orm";
import type { Db } from "../db/db.module.ts";
import { configSnapshots } from "../db/schema.ts";

/** Persistence of applied configurations; abstract so the configuration service can be tested without a database. */
export abstract class ConfigSnapshotStore {
  /** The configuration applied last, or undefined before the first one. */
  abstract latest(): Promise<PublishedConfig | undefined>;
  /** Records `config` as applied now; applying a commit again only moves its time. */
  abstract applied(config: PublishedConfig): Promise<void>;
}

@Injectable()
export class DrizzleConfigSnapshotStore extends ConfigSnapshotStore {
  constructor(@InjectDrizzle() private readonly db: Db) {
    super();
  }

  override async latest(): Promise<PublishedConfig | undefined> {
    const [row] = await this.db.select().from(configSnapshots).orderBy(desc(configSnapshots.appliedAt)).limit(1);
    return row === undefined ? undefined : { version: 1, commit: CommitSha.parse(row.commit), files: row.files };
  }

  override async applied(config: PublishedConfig): Promise<void> {
    await this.db
      .insert(configSnapshots)
      .values({ commit: config.commit, files: config.files })
      .onConflictDoUpdate({ target: configSnapshots.commit, set: { appliedAt: sql`now()` } });
  }
}
