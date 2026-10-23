import { describe, expect, it } from "vitest";
import { RUN_KEY_PREFIX } from "../../src/budget/budget.service.ts";
import { OpenRouterKeys } from "../../src/budget/openrouter-keys.ts";
import { liveEnv } from "../support/live.ts";

const env = liveEnv()?.openRouter;

/** Spends nothing: OpenRouter no longer mints run keys, it only manages those minted before. */
describe.skipIf(env === undefined)("OpenRouter keys (live)", () => {
  it("still reaches the workspace, and refuses to mint: it can't bill a user's key", { timeout: 60_000 }, async () => {
    if (env === undefined) return;
    const keys = new OpenRouterKeys(env);
    await keys.init();
    expect(Array.isArray(await keys.listByPrefix(RUN_KEY_PREFIX))).toBe(true);
    await expect(keys.create(`${RUN_KEY_PREFIX}live`, 0.01, new Date(Date.now() + 600_000), ["anthropic/claude-haiku-5.5"], { endpointId: "e", baseUrl: "https://api.example.com", key: "sk-unused-0000" })).rejects.toThrow(/can't bill a user's key/);
  });
});
