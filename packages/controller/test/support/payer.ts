import type { Db } from "../../src/db/db.module.ts";
import { users } from "../../src/db/schema.ts";

/** The account test runs are billed to (runs.payer_id references users). */
export const PAYER_ID = "payer-test-user";

export async function insertPayer(db: Db): Promise<void> {
  await db
    .insert(users)
    .values({ id: PAYER_ID, name: "The Payer", email: "payer@example.test", githubId: 583231, githubLogin: "payer" })
    .onConflictDoNothing();
}
