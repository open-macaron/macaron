import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { APP_ENV, type AppEnv } from "./config/env.ts";
import { EnvModule } from "./config/env.module.ts";
import { DbModule } from "./db/db.module.ts";
import { KeyRing } from "./keys/key-ring.ts";
import { KeyRotation } from "./keys/key-rotation.ts";
import { KEY_RING } from "./keys/llm-keys.service.ts";

/**
 * Re-seals users' LLM keys under the newest key-encryption key, in the controller's pod, after a
 * version was added to the Secret `macaron-llm-kek` (docs/DEPLOYMENT.md §4):
 *   oc exec deployment/macaron-controller -- node dist/rotate-llm-keys.js
 * Exits 1 when keys remain under a version the ring no longer has.
 */
@Module({
  imports: [EnvModule, DbModule],
  providers: [KeyRotation, { provide: KEY_RING, inject: [APP_ENV], useFactory: (env: AppEnv) => (env.LLM_KEK_DIR === undefined ? undefined : KeyRing.fromDirectory(env.LLM_KEK_DIR)) }],
})
class RotationModule {}

const app = await NestFactory.createApplicationContext(RotationModule, { logger: ["log", "warn", "error"] });
try {
  const report = await app.get(KeyRotation).rotate();
  if (report.unreadable > 0) {
    new Logger("rotate-llm-keys").error(`${String(report.unreadable)} keys are under a retired version: put it back in macaron-llm-kek, run again, then retire it`);
    process.exitCode = 1;
  }
} finally {
  await app.close();
}
