import { describe, expect, it } from "vitest";
import { BifrostKeys } from "../../src/budget/bifrost-keys.ts";
import { BudgetService, RUN_KEY_PREFIX } from "../../src/budget/budget.service.ts";
import { RunKeysRegistry } from "../../src/budget/run-keys.registry.ts";
import { SystemClock } from "../../src/common/clock.ts";
import { liveBifrost } from "../support/live.ts";

const env = liveBifrost();

/** The models a Bifrost deployment allows runs to use: each must be priced, or its budget never triggers. */
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"];

async function message(key: string, model: string): Promise<Response> {
  if (env === undefined) throw new Error("no live Bifrost");
  return fetch(new URL("v1/messages", `${env.publicUrl}/`), {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "Say ok." }] }),
  });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

/** Against `deploy/bifrost/dev.sh up`; spends well under a cent of ENMAAS usage. */
describe.skipIf(env === undefined)("Bifrost key lifecycle (live)", () => {
  it("mints a capped key that charges every allowed model, refuses others, freezes, and deletes", { timeout: 120_000 }, async () => {
    if (env === undefined) return;
    const keys = new BifrostKeys(env);
    const registry = new RunKeysRegistry("bifrost", [keys]);
    await registry.onModuleInit();
    const budget = new BudgetService(registry, new SystemClock());
    const runId = `live-test-${String(Date.now())}`;

    const key = await budget.mint(runId, 0.05, 10, MODELS);
    try {
      let spent = await budget.usage(key, new Date());
      expect(spent).toBe(0);
      for (const model of MODELS) {
        const response = await message(key.key, model);
        expect(response.status, model).toBe(200);
        await settle();
        const now = await budget.usage(key, new Date());
        expect(now, `${model} must be charged`).toBeGreaterThan(spent);
        spent = now;
      }
      expect(spent).toBeLessThan(10_000);

      // Outside the key's allowlist: Bifrost can't route it for this key (400) or refuses it (403).
      expect([400, 403]).toContain((await message(key.key, "claude-sonnet-4-6")).status);
      await expect(budget.mint(`${runId}-unpriced`, 0.05, 10, ["claude-sonnet-4-6"])).rejects.toThrow(/no price for claude-sonnet-4-6/);

      await budget.freeze(key);
      expect((await message(key.key, "claude-haiku-4-5")).status).toBe(403);
      // Settlement still reads the frozen key's spend.
      expect(await budget.usage(key, new Date())).toBe(spent);
    } finally {
      await budget.revoke(key);
    }
    expect(await keys.listByPrefix(`${RUN_KEY_PREFIX}${runId}`)).toEqual([]);
  });

  it("refuses requests without a valid virtual key, and the raw upstream key", async () => {
    if (env === undefined) return;
    expect((await message("", "claude-haiku-4-5")).status).toBe(401);
    expect((await message("sk-bf-00000000-0000-0000-0000-000000000000", "claude-haiku-4-5")).status).toBe(401);
  });
});
