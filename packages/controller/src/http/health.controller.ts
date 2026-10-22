import { Controller, Get } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { ApiExcludeController } from "@nestjs/swagger";
import { HealthCheck, type HealthCheckResult, HealthCheckService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import type { Db } from "../db/db.module.ts";

/** Kubelet probes. The edge never routes these paths to the internet. */
@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @InjectDrizzle() private readonly db: Db,
  ) {}

  @Get("healthz")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        await this.db.execute(sql`select 1`);
        return { database: { status: "up" } };
      },
    ]);
  }
}
