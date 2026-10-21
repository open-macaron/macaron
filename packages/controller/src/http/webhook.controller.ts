import { Controller, Headers, HttpCode, HttpStatus, Inject, Logger, Post, type RawBodyRequest, Req, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Webhooks } from "@octokit/webhooks";
import type { Request } from "express";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { Jobs } from "../jobs/jobs.ts";

/**
 * GitHub webhooks (open-macaron/runner's, event workflow_run), through @octokit/webhooks: the signature is
 * verified on the raw bytes and payloads are typed from GitHub's own schemas. Handlers only
 * enqueue work, so GitHub gets its answer within milliseconds.
 */
@ApiExcludeController()
@Controller("v1/webhook")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly webhooks: Webhooks;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    jobs: Jobs,
  ) {
    this.webhooks = new Webhooks({ secret: env.WEBHOOK_HMAC });
    this.webhooks.on("workflow_run.completed", async ({ payload }) => {
      // Only our runner repository's completions matter; everything else is acknowledged and ignored.
      if (payload.repository.id !== env.RUNNER_REPO_ID) return;
      const run = payload.workflow_run;
      this.logger.log(`workflow run ${String(run.id)} completed (${run.conclusion ?? "no conclusion"})`);
      await jobs.runCompleted(run.id, run.conclusion);
    });
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-github-delivery") id: string | undefined,
    @Headers("x-github-event") name: string | undefined,
    @Headers("x-hub-signature-256") signature: string | undefined,
  ): Promise<void> {
    const payload = request.rawBody?.toString("utf8");
    if (payload === undefined || id === undefined || name === undefined || signature === undefined) throw new UnauthorizedException();
    try {
      await this.webhooks.verifyAndReceive({ id, name, payload, signature });
    } catch (error: unknown) {
      this.logger.warn(`webhook ${id} rejected: ${error instanceof Error ? error.message : "unknown error"}`);
      throw new UnauthorizedException();
    }
  }
}
