import { join } from "node:path";
import { Global, Logger, Module } from "@nestjs/common";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { APP_ENV, type AppEnv } from "../config/env.ts";

/** The application's database handle. Inject with `@InjectDrizzle()`. */
export type Db = NodePgDatabase & { readonly $client: Pool };

/** Shipped next to dist/ in the image: packages/controller/drizzle. */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, "..", "..", "drizzle");

/** Serialises migrations when several instances start at once. */
const MIGRATION_LOCK = 7_207_000;

/**
 * Creates the database and brings its schema up to date before anything can inject it.
 * Migrations are additive (DEPLOYMENT.md), so an instance still running the previous version
 * keeps working while a new one migrates.
 */
export async function connectAndMigrate(databaseUrl: string): Promise<Db> {
  const logger = new Logger("Database");
  const db = drizzle({ connection: { connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 } });
  const client = await db.$client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.log("schema up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return db;
}

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: async (env: AppEnv) => ({ db: await connectAndMigrate(env.DATABASE_URL) }),
    }),
  ],
  exports: [DrizzleModule],
})
export class DbModule {}
