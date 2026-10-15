import { BadRequestException, Controller, Headers, HttpCode, HttpStatus, Inject, Logger, Post, type RawBodyRequest, Req, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { verify } from "@octokit/webhooks-methods";
import type { Request } from "express";
import { z } from "zod";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { Jobs } from "../jobs/jobs.ts";

const WorkflowRunEvent = z.looseObject({
  action: z.string(),
  workflow_run: z.looseObject({ id: z.int().positive(), conclusion: z.string().nullable() }),
  repository: z.looseObject({ id: z.int().positive() }),
});

/**
 * GitHub webhooks (org webhook on open-macaron). The signature is checked on the raw bytes
 * before anything is parsed; the handler only enqueues work and answers within milliseconds.
 */
@ApiExcludeController()
@Controller("v1/webhook")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly jobs: Jobs,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Headers("x-github-event") event: string | undefined,
  ): Promise<void> {
    const raw = request.rawBody;
    if (raw === undefined || signature === undefined) throw new UnauthorizedException();
    if (!(await verify(this.env.WEBHOOK_HMAC, raw.toString("utf8"), signature))) throw new UnauthorizedException();

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new BadRequestException();
    }

    if (event === "workflow_run") {
      const parsed = WorkflowRunEvent.safeParse(payload);
      if (!parsed.success) throw new BadRequestException();
      const { action, workflow_run: run, repository } = parsed.data;
      // Only our runner repository's completions matter; everything else is acknowledged and ignored.
      if (action === "completed" && repository.id === this.env.RUNNER_REPO_ID) {
        this.logger.log(`workflow run ${String(run.id)} completed (${run.conclusion ?? "no conclusion"})`);
        await this.jobs.runCompleted(run.id, run.conclusion);
      }
    }
  }
}
