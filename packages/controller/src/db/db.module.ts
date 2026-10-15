import { Global, Module } from "@nestjs/common";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { APP_ENV, type AppEnv } from "../config/env.ts";

/** The application's database handle. Inject with `@InjectDrizzle()`. */
export type Db = NodePgDatabase;

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({
        drizzle,
        connection: { connectionString: env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 },
      }),
    }),
  ],
  exports: [DrizzleModule],
})
export class DbModule {}
