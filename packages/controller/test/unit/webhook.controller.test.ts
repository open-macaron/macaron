import { createHmac } from "node:crypto";
import { UnauthorizedException, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { WebhookController } from "../../src/http/webhook.controller.ts";
import { Jobs } from "../../src/jobs/jobs.ts";
import { testEnv } from "../support/env.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const CONFIG_REPO_ID = 3003;
const SHA = "a".repeat(40);

function setup() {
  const env = testEnv({ WEBHOOK_HMAC: SECRET, CONFIG_URL: "https://config.example.test/v1", CONFIG_REPO_ID: String(CONFIG_REPO_ID) });
  const jobs = new Jobs(env);
  const configPublished = vi.spyOn(jobs, "configPublished").mockResolvedValue();
  const runCompleted = vi.spyOn(jobs, "runCompleted").mockResolvedValue();
  return { controller: new WebhookController(env, jobs), configPublished, runCompleted };
}

function request(body: string): Pick<RawBodyRequest<Request>, "rawBody"> {
  return { rawBody: Buffer.from(body) };
}

async function deliver(controller: WebhookController, event: string, payload: unknown, secret = SECRET): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  await controller.receive(request(body), "delivery-1", event, signature);
}

const deploymentStatus = (overrides: { repoId?: number; environment?: string; state?: string } = {}) => ({
  action: "created",
  repository: { id: overrides.repoId ?? CONFIG_REPO_ID },
  deployment: { sha: SHA, environment: overrides.environment ?? "github-pages" },
  deployment_status: { state: overrides.state ?? "success" },
});

describe("WebhookController", () => {
  it("queues a reload when open-macaron/config's Pages deployment succeeds", async () => {
    const { controller, configPublished } = setup();

    await deliver(controller, "deployment_status", deploymentStatus());

    expect(configPublished).toHaveBeenCalledWith(SHA);
  });

  it("ignores other repositories, environments and states", async () => {
    const { controller, configPublished } = setup();

    await deliver(controller, "deployment_status", deploymentStatus({ repoId: 1 }));
    await deliver(controller, "deployment_status", deploymentStatus({ environment: "production" }));
    await deliver(controller, "deployment_status", deploymentStatus({ state: "in_progress" }));

    expect(configPublished).not.toHaveBeenCalled();
  });

  it("refuses a delivery signed with another secret", async () => {
    const { controller, configPublished } = setup();

    await expect(deliver(controller, "deployment_status", deploymentStatus(), "f".repeat(32))).rejects.toThrow(UnauthorizedException);
    expect(configPublished).not.toHaveBeenCalled();
  });

  it("still queues the runner's completions", async () => {
    const { controller, runCompleted } = setup();

    await deliver(controller, "workflow_run", { action: "completed", repository: { id: 1001 }, workflow_run: { id: 42, conclusion: "success" } });

    expect(runCompleted).toHaveBeenCalledWith(42, "success");
  });
});
