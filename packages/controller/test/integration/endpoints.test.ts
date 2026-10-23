import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Capability } from "@open-macaron/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldRefused } from "../../src/common/errors.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { adminAudit, llmEndpoints, users } from "../../src/db/schema.ts";
import { EndpointsService } from "../../src/endpoints/endpoints.service.ts";
import { testEnv } from "../support/env.ts";
import { startPostgres } from "../support/postgres.ts";

const admin = { id: "admin-user", githubLogin: "octocat" };
const answers: Record<string, readonly string[]> = {
  "api.anthropic.example": ["160.79.104.10"],
  "gateway.example": ["93.184.215.14"],
  "internal.example": ["10.12.0.4"],
};
const resolve = (host: string): Promise<readonly string[]> => {
  const found = answers[host];
  return found === undefined ? Promise.reject(new Error("ENOTFOUND")) : Promise.resolve(found);
};
const defaults = JSON.stringify([
  { name: "Anthropic API", baseUrl: "https://api.anthropic.example/" },
  { name: "Internal", baseUrl: "https://internal.example" },
]);

let container: StartedPostgreSqlContainer;
let db: Db;
let service: EndpointsService;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await db.insert(users).values({ id: admin.id, name: "The Octocat", email: "octocat@example.test", githubId: 1, githubLogin: admin.githubLogin, role: "admin", capabilities: Capability.options });
  service = new EndpointsService(db, testEnv({ LLM_ENDPOINT_DEFAULTS: defaults }), resolve);
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

async function refusal(promise: Promise<unknown>): Promise<FieldRefused> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FieldRefused) return error;
    throw error;
  }
  throw new Error("expected a FieldRefused");
}

describe("EndpointsService", () => {
  it("approves the deployment's defaults at start, leaving out a private host", async () => {
    await service.onApplicationBootstrap();
    expect((await service.list()).map(({ name, baseUrl, createdBy }) => ({ name, baseUrl, createdBy }))).toEqual([{ name: "Anthropic API", baseUrl: "https://api.anthropic.example", createdBy: null }]);
  });

  it("never updates a default an admin changed, and never re-adds one", async () => {
    const [anthropic] = await service.list();
    await service.setEnabled(anthropic?.id ?? "", false, admin);
    await service.onApplicationBootstrap();
    const after = await service.list();
    expect(after).toHaveLength(1);
    expect(after[0]?.enabled).toBe(false);
  });

  it("approves an endpoint on a public host, with an audit record", async () => {
    const endpoint = await service.approve({ name: "Company gateway", baseUrl: "https://gateway.example", pricingNote: "Billed by the company." }, admin);
    expect(endpoint).toMatchObject({ name: "Company gateway", baseUrl: "https://gateway.example", enabled: true, createdBy: "octocat", pricingNote: "Billed by the company." });
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.target, `endpoint:${endpoint.id}`));
    expect(audit).toMatchObject({ action: "endpoint.approve", actorId: admin.id });
  });

  it("refuses a private host, an unresolvable one, and a base URL already approved", async () => {
    expect((await refusal(service.approve({ name: "Internal", baseUrl: "https://internal.example", pricingNote: null }, admin))).message).toMatch(/private or reserved/);
    expect((await refusal(service.approve({ name: "Metadata", baseUrl: "https://169.254.169.254", pricingNote: null }, admin))).field).toBe("baseUrl");
    expect((await refusal(service.approve({ name: "Nowhere", baseUrl: "https://nowhere.example", pricingNote: null }, admin))).message).toMatch(/doesn't resolve/);
    expect((await refusal(service.approve({ name: "Again", baseUrl: "https://gateway.example", pricingNote: null }, admin))).message).toMatch(/already an endpoint/);
  });

  it("enables and disables, audited; only enabled endpoints are offered", async () => {
    const [, gateway] = await service.list();
    await service.setEnabled(gateway?.id ?? "", false, admin);
    expect(await service.enabled()).toEqual([]);
    const enabled = await service.setEnabled(gateway?.id ?? "", true, admin);
    expect(enabled).toMatchObject({ enabled: true, baseUrl: "https://gateway.example" });
    expect((await service.enabled()).map((endpoint) => endpoint.name)).toEqual(["Company gateway"]);
    const actions = (await db.select().from(adminAudit).where(eq(adminAudit.target, `endpoint:${gateway?.id ?? ""}`))).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["endpoint.approve", "endpoint.disable", "endpoint.enable"]));
    expect((await refusal(service.setEnabled("00000000-0000-4000-8000-000000000000", true, admin))).field).toBe("id");
  });

  it("keeps the base URL unique in the database itself", async () => {
    await expect(db.insert(llmEndpoints).values({ name: "Dup", baseUrl: "https://gateway.example" })).rejects.toThrow();
  });
});
