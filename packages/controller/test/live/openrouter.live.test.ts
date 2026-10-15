import { describe, expect, it } from "vitest";
import { BudgetService, RUN_KEY_PREFIX } from "../../src/budget/budget.service.ts";
import { OpenRouterKeys } from "../../src/budget/openrouter-keys.ts";
import { SystemClock } from "../../src/common/clock.ts";
import { liveEnv } from "../support/live.ts";

const env = liveEnv();

/** Spends about $0.0001 of real OpenRouter credit. */
describe.skipIf(env === undefined)("OpenRouter key lifecycle (live)", () => {
  it("mints a capped, expiring key in the workspace, records its usage, and deletes it", { timeout: 240_000 }, async () => {
    if (env === undefined) return;
    const keys = new OpenRouterKeys(env);
    await keys.onModuleInit();
    const budget = new BudgetService(keys, new SystemClock());
    const runId = `live-test-${String(Date.now())}`;

    const key = await budget.mint(runId, 0.01, 10);
    try {
      const status = await keys.status(key.hash);
      expect(status.name).toBe(`${RUN_KEY_PREFIX}${runId}`);
      expect(status.disabled).toBe(false);

      const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "anthropic/claude-haiku-5.5", max_tokens: 5, messages: [{ role: "user", content: "Say ok." }] }),
      });
      expect(response.status).toBe(200);

      // Same sequence as production: freeze at completion, read usage once it has arrived.
      await budget.freeze(key.hash);
      let costMicros = 0;
      for (let attempt = 0; attempt < 12 && costMicros === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        costMicros = await budget.usage(key.hash);
      }
      expect(costMicros).toBeGreaterThan(0);
      expect(costMicros).toBeLessThan(10_000);
    } finally {
      await budget.revoke(key.hash);
    }
    const leftovers = await keys.listByPrefix(`${RUN_KEY_PREFIX}${runId}`);
    expect(leftovers).toEqual([]);
  });
});
