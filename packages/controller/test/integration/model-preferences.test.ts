import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { type ConfigSnapshot, loadConfigTree, type RepoConfig } from "@open-macaron/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PriceList } from "../../src/budget/price-list.ts";
import { FieldRefused } from "../../src/common/errors.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { users } from "../../src/db/schema.ts";
import { ModelPreferencesService } from "../../src/keys/model-preferences.service.ts";
import { FakeClock } from "../support/fakes.ts";
import { startPostgres } from "../support/postgres.ts";

const SETTINGS = "https://macaron.example.test/settings/key";
/** `free-preview` is marked free and capped by tokens; `forgotten` has a zero price and no mark: refused. */
const prices = PriceList.of(
  new Map([
    ["claude-sonnet-5-5", { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 }],
    ["claude-haiku-5-5", { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 }],
    ["free-preview", { input_cost_per_token: 0, output_cost_per_token: 0 }],
    ["forgotten", { input_cost_per_token: 0, output_cost_per_token: 0 }],
  ]),
  new Map([["free-preview", 5_000_000]]),
);

let container: StartedPostgreSqlContainer;
let db: Db;
let service: ModelPreferencesService;
let config: RepoConfig;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  const snapshot: ConfigSnapshot = await loadConfigTree(fileURLToPath(new URL("../../../contracts/test/fixtures/config", import.meta.url)));
  const found = snapshot.repos.values().next().value;
  if (found === undefined) throw new Error("the configuration fixtures have no repository");
  config = found;
  await db.insert(users).values({ id: "alice", name: "Alice", email: "alice@example.test", githubId: 31, githubLogin: "alice" });
  service = new ModelPreferencesService(db, prices, new FakeClock(new Date("2026-11-04T12:00:00Z")));
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

describe("ModelPreferencesService", () => {
  it("offers the priced models and the free ones, and nothing picked yet", async () => {
    expect(await service.mine("alice")).toEqual({ models: ["claude-haiku-5-5", "claude-sonnet-5-5", "free-preview"], free: ["free-preview"], preference: {} });
  });

  it("refuses a pick without a pinned price and without the free mark, naming its field", async () => {
    await expect(service.save("alice", { model: "forgotten" })).rejects.toThrow(FieldRefused);
    await expect(service.save("alice", { model: "unknown-model" })).rejects.toThrow(/has no pinned price/);
    await expect(service.save("alice", { fastModel: "forgotten" })).rejects.toMatchObject({ field: "fastModel" });
    expect((await service.mine("alice")).preference).toEqual({});
  });

  it("accepts a free model as a pick", async () => {
    expect(await service.save("alice", { model: "free-preview" })).toMatchObject({ preference: { model: "free-preview" } });
    await service.save("alice", {});
  });

  it("stores the picks, and a run uses them over the configuration's defaults", async () => {
    expect(await service.save("alice", { model: "claude-haiku-5-5", fastModel: "claude-haiku-5-5" })).toMatchObject({ preference: { model: "claude-haiku-5-5", fastModel: "claude-haiku-5-5" } });
    expect(await service.resolve("alice", "plan", config, SETTINGS)).toEqual({ models: { model: "claude-haiku-5-5", fastModel: "claude-haiku-5-5" } });
  });

  it("keeps a model the configuration sets for a mode: reviews stay on the one their rules were tuned for", async () => {
    expect(config.models.review).toBe("claude-sonnet-5-5");
    expect(await service.resolve("alice", "review", config, SETTINGS)).toEqual({ models: { model: "claude-sonnet-5-5", fastModel: "claude-haiku-5-5" } });
  });

  it("leaves every choice to the configuration when the user picked nothing", async () => {
    await service.save("alice", {});
    expect(await service.resolve("alice", "plan", config, SETTINGS)).toEqual({ models: { model: config.models.plan ?? config.model, fastModel: config.fastModel } });
  });

  it("refuses a run whose pick lost its price, pointing at the key page", async () => {
    await service.save("alice", { model: "claude-haiku-5-5" });
    // A redeploy took the model out of the pinned prices.
    const repriced = new ModelPreferencesService(db, PriceList.of(new Map([["claude-sonnet-5-5", { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 }]])), new FakeClock(new Date()));
    const resolved = await repriced.resolve("alice", "plan", config, SETTINGS);
    expect(resolved).toEqual({ refusal: expect.stringContaining("claude-haiku-5-5") });
    expect(JSON.stringify(resolved)).toContain(SETTINGS);
    // A review doesn't use the pick: the configuration's model runs it.
    expect(await repriced.resolve("alice", "review", config, SETTINGS)).toEqual({ models: { model: "claude-sonnet-5-5", fastModel: config.fastModel } });
  });
});
