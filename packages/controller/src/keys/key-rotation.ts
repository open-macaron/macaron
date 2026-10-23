import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/db.module.ts";
import { llmKeys } from "../db/schema.ts";
import { KeyRing, keyAad } from "./key-ring.ts";
import { KEY_RING } from "./llm-keys.service.ts";

export interface RotationReport {
  readonly current: number;
  readonly resealed: number;
  /** Keys under a version the ring no longer has: unreadable, their owners must save them again. */
  readonly unreadable: number;
}

/** Re-seals every stored key under the key ring's newest version, so older versions can be retired. */
@Injectable()
export class KeyRotation {
  private readonly logger = new Logger(KeyRotation.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(KEY_RING) private readonly ring: KeyRing | undefined,
  ) {}

  async rotate(): Promise<RotationReport> {
    const ring = this.ring;
    if (ring === undefined) throw new Error("LLM_KEK_DIR is not configured: there is no key ring to rotate to");
    const stale = await this.db.select({ userId: llmKeys.userId, kekVersion: llmKeys.kekVersion }).from(llmKeys).where(ne(llmKeys.kekVersion, ring.current));
    let resealed = 0;
    let unreadable = 0;
    for (const { userId, kekVersion } of stale) {
      if (!ring.has(kekVersion)) {
        unreadable += 1;
        continue;
      }
      // One transaction per key, the row locked: a user saving a new key meanwhile wins, untouched.
      const done = await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(llmKeys).where(and(eq(llmKeys.userId, userId), eq(llmKeys.kekVersion, kekVersion))).for("update");
        if (row === undefined) return false;
        const aad = keyAad(row.userId, row.endpointId);
        const sealed = ring.seal(ring.open(row, aad), aad);
        await tx.update(llmKeys).set(sealed).where(eq(llmKeys.userId, userId));
        return true;
      });
      if (done) resealed += 1;
    }
    this.logger.log(`key rotation: ${String(resealed)} re-sealed under v${String(ring.current)}, ${String(unreadable)} under a retired version`);
    return { current: ring.current, resealed, unreadable };
  }
}
