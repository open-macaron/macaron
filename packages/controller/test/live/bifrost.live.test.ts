import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BifrostKeys } from "../../src/budget/bifrost-keys.ts";
import { BudgetService, RUN_KEY_PREFIX } from "../../src/budget/budget.service.ts";
import { PriceList } from "../../src/budget/price-list.ts";
import { RunKeysRegistry } from "../../src/budget/run-keys.registry.ts";
import { SystemClock } from "../../src/common/clock.ts";
import { liveBifrost, liveUpstream } from "../support/live.ts";

const env = liveBifrost();
const user = liveUpstream();

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

/** Against `deploy/bifrost/dev.sh up`, with the developer's key standing in for a user's; spends well under a cent. */
describe.skipIf(env === undefined || user === undefined)("Bifrost run keys over a user's key (live)", () => {
  it("bills a run to its payer's key alone, charges every allowed model, and takes the key out of Bifrost at freeze", { timeout: 180_000 }, async () => {
    if (env === undefined || user === undefined) return;
    const keys = new BifrostKeys(env, PriceList.fromFile(env.pricingFile));
    const registry = new RunKeysRegistry("bifrost", [keys]);
    await registry.onModuleInit();
    const budget = new BudgetService(registry, new SystemClock());
    // A fresh endpoint each time: its provider is created, priced, and must work at once.
    const endpointId = randomUUID();
    const runId = `live-test-${String(Date.now())}`;

    const key = await budget.mint(runId, 0.05, 10, MODELS, { endpointId, ...user });
    // Another user's run on the same endpoint, with a key the endpoint refuses.
    const other = await budget.mint(`${runId}-other`, 0.05, 10, MODELS, { endpointId, baseUrl: user.baseUrl, key: "sk-ant-not-a-real-key-0000" });
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
      // Each virtual key uses its own payer's key only: the other run never reaches the real one.
      for (let attempt = 0; attempt < 5; attempt++) expect((await message(other.key, "claude-haiku-4-5")).status).toBe(401);

      // Outside the key's allowlist: Bifrost can't route it for this key (400) or refuses it (403).
      expect([400, 403]).toContain((await message(key.key, "claude-sonnet-4-6")).status);
      await expect(budget.mint(`${runId}-unpriced`, 0.05, 10, ["claude-sonnet-4-6"], { endpointId, ...user })).rejects.toThrow(/no price for claude-sonnet-4-6/);

      await budget.freeze(key);
      expect((await message(key.key, "claude-haiku-4-5")).status).toBe(403);
      // The user's key left Bifrost; settlement still reads the frozen key's spend.
      expect(await keys.sweepUpstreamKeys(`${RUN_KEY_PREFIX}${runId}`, new Set([`${RUN_KEY_PREFIX}${runId}-other`]))).toEqual([]);
      expect(await budget.usage(key, new Date())).toBe(spent);
    } finally {
      await budget.revoke(key);
      await budget.revoke(other);
    }
    expect(await keys.listByPrefix(`${RUN_KEY_PREFIX}${runId}`)).toEqual([]);
    expect(await keys.sweepUpstreamKeys(`${RUN_KEY_PREFIX}${runId}`, new Set())).toEqual([]);
  });

  it("refuses requests without a valid virtual key", async () => {
    if (env === undefined) return;
    expect((await message("", "claude-haiku-4-5")).status).toBe(401);
    expect((await message("sk-bf-00000000-0000-0000-0000-000000000000", "claude-haiku-4-5")).status).toBe(401);
  });
});
