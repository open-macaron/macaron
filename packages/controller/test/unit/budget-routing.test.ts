import { describe, expect, it } from "vitest";
import { BudgetService, RUN_KEY_PREFIX, type RunKeyRef } from "../../src/budget/budget.service.ts";
import { type KeyStatus, type LlmBackend, type ProvisionedKey, RunKeys } from "../../src/budget/run-keys.ts";
import { RunKeysRegistry } from "../../src/budget/run-keys.registry.ts";
import { FakeClock } from "../support/fakes.ts";

/** Records every call, so a test can tell which backend a key operation reached. */
class RecordingKeys extends RunKeys {
  readonly calls: string[] = [];
  readonly baseUrl: string;
  readonly usageLagMs: number;

  constructor(
    readonly backend: LlmBackend,
    private readonly listed: readonly KeyStatus[] = [],
  ) {
    super();
    this.baseUrl = `https://${backend}.example.test`;
    this.usageLagMs = backend === "openrouter" ? 90_000 : 15_000;
  }

  init(): Promise<void> {
    this.calls.push("init");
    return Promise.resolve();
  }

  create(name: string, limitUsd: number, expiresAt: Date, models: readonly string[]): Promise<ProvisionedKey> {
    this.calls.push(`create ${name} ${String(limitUsd)} ${expiresAt.toISOString()} ${models.join(",")}`);
    return Promise.resolve({ key: `${this.backend}-secret`, hash: `${this.backend}-hash` });
  }

  disable(hash: string): Promise<void> {
    this.calls.push(`disable ${hash}`);
    return Promise.resolve();
  }

  delete(hash: string): Promise<void> {
    this.calls.push(`delete ${hash}`);
    return Promise.resolve();
  }

  listByPrefix(prefix: string): Promise<KeyStatus[]> {
    this.calls.push(`list ${prefix}`);
    return Promise.resolve([...this.listed]);
  }

  spentSince(hash: string): Promise<number> {
    this.calls.push(`spent ${hash}`);
    return Promise.resolve(0.25);
  }
}

const now = new Date("2026-10-19T12:00:00Z");

function setup(active: LlmBackend) {
  const openrouter = new RecordingKeys("openrouter", [{ hash: "or-1", name: `${RUN_KEY_PREFIX}a`, disabled: false, createdAt: now }]);
  const bifrost = new RecordingKeys("bifrost", [{ hash: "bf-1", name: `${RUN_KEY_PREFIX}b`, disabled: true, createdAt: now }]);
  const registry = new RunKeysRegistry(active, [openrouter, bifrost]);
  return { openrouter, bifrost, registry, budget: new BudgetService(registry, new FakeClock(now)) };
}

describe("BudgetService routing", () => {
  it("mints on the active backend and says where the key lives", async () => {
    const { openrouter, bifrost, budget } = setup("bifrost");

    const minted = await budget.mint("run-1", 0.5, 75, ["claude-sonnet-5-5", "claude-haiku-4-5"]);

    expect(minted).toEqual({ backend: "bifrost", key: "bifrost-secret", hash: "bifrost-hash" });
    expect(bifrost.calls).toEqual([`create ${RUN_KEY_PREFIX}run-1 0.5 2026-10-19T13:15:00.000Z claude-sonnet-5-5,claude-haiku-4-5`]);
    expect(openrouter.calls).toEqual([]);
    expect(budget.baseUrl(minted.backend)).toBe("https://bifrost.example.test");
  });

  it("freezes, reads and revokes a key on the backend that minted it, whichever is active now", async () => {
    const { openrouter, bifrost, budget } = setup("bifrost");
    const ref: RunKeyRef = { backend: "openrouter", hash: "or-old" };

    await budget.freeze(ref);
    expect(await budget.usage(ref, now)).toBe(250_000);
    await budget.revoke(ref);

    expect(openrouter.calls).toEqual(["disable or-old", "spent or-old", "disable or-old", "delete or-old"]);
    expect(bifrost.calls).toEqual([]);
    expect(budget.usageLagMs("openrouter")).toBe(90_000);
  });

  it("lists run keys on every configured backend for the sweeper", async () => {
    const { budget } = setup("openrouter");

    const keys = await budget.runKeys();

    expect(keys.map((key) => [key.backend, key.hash])).toEqual([
      ["openrouter", "or-1"],
      ["bifrost", "bf-1"],
    ]);
  });

  it("initialises every backend before accepting work", async () => {
    const { openrouter, bifrost, registry } = setup("openrouter");

    await registry.onModuleInit();

    expect([openrouter.calls, bifrost.calls]).toEqual([["init"], ["init"]]);
  });

  it("refuses to start with an active backend that isn't configured", () => {
    expect(() => new RunKeysRegistry("bifrost", [new RecordingKeys("openrouter")])).toThrow(/"bifrost" is selected but not configured/);
  });

  it("doesn't throw when revoking a key whose backend is no longer configured: the error is logged", async () => {
    const budget = new BudgetService(new RunKeysRegistry("openrouter", [new RecordingKeys("openrouter")]), new FakeClock(now));

    await expect(budget.revoke({ backend: "bifrost", hash: "bf-gone" })).resolves.toBeUndefined();
  });
});
