/**
 * Release step, run by the `macaron-migrate` unit before every controller start.
 * Never runs inside the application process (DEPLOYMENT.md §2).
 */
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";

// eslint-disable-next-line no-restricted-syntax -- standalone entrypoint, outside the Nest config module
const { DATABASE_URL } = z.object({ DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//) }).parse(process.env);

const db = drizzle({ connection: { connectionString: DATABASE_URL, max: 1 } });
try {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, "..", "..", "drizzle") });
  console.info("migrations applied");
} finally {
  await db.$client.end();
}
