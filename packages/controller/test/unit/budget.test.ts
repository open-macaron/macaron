import { describe, expect, it } from "vitest";
import { BudgetService, RUN_KEY_PREFIX } from "../../src/budget/budget.service.ts";
import { UpstreamError } from "../../src/common/errors.ts";
import { type KeyStatus, type ProvisionedKey, RunKeys, type RunLimits, type TokenUsage, type Upstream } from "../../src/budget/run-keys.ts";
import { FakeClock } from "../support/fakes.ts";

/** Records every call, so a test can tell what reached the gateway. */
class RecordingKeys extends RunKeys {
  readonly calls: string[] = [];
  readonly baseUrl = "https://bifrost.example.test";
  readonly usageLagMs = 15_000;
  tokens: TokenUsage | undefined;

  constructor(
    private readonly listed: readonly KeyStatus[] = [],
    private readonly priced: ReadonlySet<string> = new Set(["model-a", "model-b"]),
  ) {
    super();
  }

  init(): Promise<void> {
    this.calls.push("init");
    return Promise.resolve();
  }

  unbillable(models: readonly string[]): Promise<string[]> {
    return Promise.resolve(models.filter((model) => !this.priced.has(model)));
  }

  create(name: string, limits: RunLimits, expiresAt: Date, models: readonly string[], upstream: Upstream): Promise<ProvisionedKey> {
    this.calls.push(`create ${name} ${String(limits.usd)} ${String(limits.tokens ?? "-")} ${expiresAt.toISOString()} ${models.join(",")} on ${upstream.endpointId}`);
    return Promise.resolve({ key: "vk-secret", hash: "vk-hash" });
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

  sweepUpstreamKeys(prefix: string, keep: ReadonlySet<string>): Promise<string[]> {
    this.calls.push(`sweep ${prefix} keeping ${[...keep].join(",")}`);
    return Promise.resolve([`${prefix}orphan`]);
  }

  spentSince(hash: string): Promise<number> {
    this.calls.push(`spent ${hash}`);
    return Promise.resolve(0.25);
  }

  tokenUsage(hash: string): Promise<TokenUsage | undefined> {
    this.calls.push(`tokens ${hash}`);
    return Promise.resolve(this.tokens);
  }
}

const now = new Date("2026-10-19T12:00:00Z");
const upstream: Upstream = { endpointId: "ep-1", baseUrl: "https://gateway.example.com", key: "sk-user" };

function setup(configuredModels: readonly string[] = ["model-a"]) {
  const keys = new RecordingKeys([{ hash: "vk-1", name: `${RUN_KEY_PREFIX}a`, disabled: true, createdAt: now }]);
  return { keys, budget: new BudgetService(keys, new FakeClock(now), () => configuredModels) };
}

describe("BudgetService", () => {
  it("mints a key named after its run, expiring after its TTL, and says where runners send it", async () => {
    const { keys, budget } = setup();

    const minted = await budget.mint("run-1", { usd: 0.5 }, 75, ["claude-sonnet-5-5", "claude-haiku-4-5"], upstream);

    expect(minted).toEqual({ key: "vk-secret", hash: "vk-hash" });
    expect(keys.calls).toEqual([`create ${RUN_KEY_PREFIX}run-1 0.5 - 2026-10-19T13:15:00.000Z claude-sonnet-5-5,claude-haiku-4-5 on ep-1`]);
    expect(budget.baseUrl).toBe("https://bifrost.example.test");
    expect(budget.usageLagMs).toBe(15_000);
  });

  it("passes a free run's token ceiling to the gateway", async () => {
    const { keys, budget } = setup();

    await budget.mint("run-2", { usd: 0.5, tokens: 2_000_000 }, 75, ["model-a"], upstream);

    expect(keys.calls).toEqual([`create ${RUN_KEY_PREFIX}run-2 0.5 2000000 2026-10-19T13:15:00.000Z model-a on ep-1`]);
  });

  it("freezes, reads and revokes a key", async () => {
    const { keys, budget } = setup();

    await budget.freeze({ hash: "vk-old" });
    expect(await budget.usage({ hash: "vk-old" }, now)).toBe(250_000);
    await budget.revoke({ hash: "vk-old" });

    expect(keys.calls).toEqual(["disable vk-old", "spent vk-old", "disable vk-old", "delete vk-old"]);
  });

  it("reads a key's token counter, and says nothing of a key it can't read", async () => {
    const keys = new RecordingKeys();
    keys.tokens = { used: 2_000_001, limit: 2_000_000 };
    const budget = new BudgetService(keys, new FakeClock(now));

    expect(await budget.tokenUsage({ hash: "vk-old" })).toEqual({ used: 2_000_001, limit: 2_000_000 });
    keys.tokenUsage = () => Promise.reject(new UpstreamError("bifrost", "read key tokens failed (HTTP 500)", 500));
    expect(await budget.tokenUsage({ hash: "vk-old" })).toBeUndefined();
  });

  it("lists run keys and sweeps upstream keys for the sweeper", async () => {
    const { keys, budget } = setup();

    expect((await budget.runKeys()).map((key) => key.hash)).toEqual(["vk-1"]);
    expect(await budget.sweepUpstreamKeys(new Set([`${RUN_KEY_PREFIX}a`]))).toEqual([`${RUN_KEY_PREFIX}orphan`]);
    expect(keys.calls).toEqual([`list ${RUN_KEY_PREFIX}`, `sweep ${RUN_KEY_PREFIX} keeping ${RUN_KEY_PREFIX}a`]);
  });

  it("checks the gateway before accepting work, and fails start-up when it doesn't answer", async () => {
    const { keys, budget } = setup();

    await budget.onModuleInit();
    expect(keys.calls).toEqual(["init"]);

    keys.init = () => Promise.reject(new Error("Invalid admin credentials"));
    await expect(budget.onModuleInit()).rejects.toThrow(/Invalid admin credentials/);
  });

  it("refuses to start when the gateway can't price a configured model", async () => {
    await expect(setup(["model-a", "claude-sonnet-4-6"]).budget.onApplicationBootstrap()).rejects.toThrow(/no price or free mark for configured models: claude-sonnet-4-6/);
    await expect(setup(["model-a", "model-b"]).budget.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("doesn't throw when revoking a key that's already gone, nor when the gateway fails: the error is logged", async () => {
    const { keys, budget } = setup();
    keys.delete = () => Promise.reject(new UpstreamError("bifrost", "delete failed (HTTP 404)", 404));
    await expect(budget.revoke({ hash: "vk-gone" })).resolves.toBeUndefined();

    keys.disable = () => Promise.reject(new UpstreamError("bifrost", "disable failed (HTTP 502)", 502));
    await expect(budget.revoke({ hash: "vk-1" })).resolves.toBeUndefined();
  });
});
