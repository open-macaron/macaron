import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BifrostKeys } from "../../src/budget/bifrost-keys.ts";
import { UpstreamError } from "../../src/common/errors.ts";
import type { BifrostEnv } from "../../src/config/env.ts";

const ADMIN = "http://bifrost.internal.test:8080";
const settings: BifrostEnv = {
  adminUrl: ADMIN,
  publicUrl: "https://macaron.example.test/llm/anthropic",
  username: "macaron",
  password: "admin-password-0000000000",
  provider: "anthropic",
  requestsPerMinute: 60,
};

const prices = {
  models: [
    { name: "claude-sonnet-5-5", provider: "anthropic", input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 },
    { name: "claude-haiku-4-5", provider: "anthropic", input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
    { name: "vendor/unpriced-model", provider: "anthropic" },
  ],
  total: 3,
};

function budget(currentUsage: number) {
  const at = "2026-10-19T12:00:00Z";
  return { id: "b-1", max_limit: 0.5, reset_duration: "1Y", last_reset: at, current_usage: currentUsage, config_hash: null, created_at: at, updated_at: at };
}

function listed(id: string, name: string, isActive = true) {
  return { id, name, value: "sk-bf-hidden", is_active: isActive, provider_configs: [], mcp_configs: [], calendar_aligned: false, config_hash: "h", created_at: "2026-10-19T12:00:00Z", updated_at: "2026-10-19T12:00:00Z" };
}

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

/** BifrostKeys with prices loaded, as after module init. */
async function keys(): Promise<BifrostKeys> {
  server.use(http.get(`${ADMIN}/api/models/details`, () => HttpResponse.json(prices)));
  const bifrost = new BifrostKeys(settings);
  await bifrost.init();
  return bifrost;
}

describe("BifrostKeys", () => {
  it("creates a capped, expiring, rate-limited key that allows only the run's models", async () => {
    const bifrost = await keys();
    let seen: unknown;
    let auth: string | null = null;
    server.use(
      http.post(`${ADMIN}/api/governance/virtual-keys`, async ({ request }) => {
        auth = request.headers.get("authorization");
        seen = await request.json();
        return HttpResponse.json({ message: "created", virtual_key: { ...listed("vk-1", "macaron-run-r1"), value: "sk-bf-run-key" } });
      }),
    );

    const key = await bifrost.create("macaron-run-r1", 0.5, new Date("2026-10-19T13:15:00Z"), ["claude-sonnet-5-5", "claude-haiku-4-5", "claude-sonnet-5-5"]);

    expect(key).toEqual({ key: "sk-bf-run-key", hash: "vk-1" });
    expect(auth).toBe(`Basic ${Buffer.from("macaron:admin-password-0000000000").toString("base64")}`);
    expect(seen).toEqual({
      name: "macaron-run-r1",
      provider_configs: [{ provider: "anthropic", allowed_models: ["claude-sonnet-5-5", "claude-haiku-4-5"], key_ids: ["*"] }],
      budgets: [{ max_limit: 0.5, reset_duration: "1Y" }],
      rate_limit: { request_max_limit: 60, request_reset_duration: "1m" },
      expires_at: "2026-10-19T13:15:00.000Z",
      delete_after_expire: false,
      disable_content_logging: true,
    });
    expect(bifrost.baseUrl).toBe("https://macaron.example.test/llm/anthropic");
  });

  it("refuses a model without a price, after reloading prices once", async () => {
    const bifrost = await keys();
    let priceLoads = 0;
    server.use(
      http.get(`${ADMIN}/api/models/details`, () => {
        priceLoads++;
        return HttpResponse.json(prices);
      }),
      http.post(`${ADMIN}/api/governance/virtual-keys`, () => HttpResponse.json({}, { status: 500 })),
    );

    const attempt = bifrost.create("macaron-run-r2", 0.5, new Date("2026-10-19T13:15:00Z"), ["claude-haiku-4-5", "vendor/unpriced-model"]);

    await expect(attempt).rejects.toThrow(/no price for vendor\/unpriced-model/);
    expect(priceLoads).toBe(1);
  });

  it("disables a key by marking it inactive", async () => {
    const bifrost = await keys();
    let seen: unknown;
    server.use(
      http.put(`${ADMIN}/api/governance/virtual-keys/vk-1`, async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ message: "updated", virtual_key: listed("vk-1", "macaron-run-r1", false) });
      }),
    );

    await bifrost.disable("vk-1");

    expect(seen).toEqual({ is_active: false });
  });

  it("treats deleting a key that is already gone as done, and reports other failures", async () => {
    const bifrost = await keys();
    server.use(
      http.delete(`${ADMIN}/api/governance/virtual-keys/vk-gone`, () => HttpResponse.json({ error: "not found" }, { status: 404 })),
      http.delete(`${ADMIN}/api/governance/virtual-keys/vk-broken`, () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );

    await expect(bifrost.delete("vk-gone")).resolves.toBeUndefined();
    await expect(bifrost.delete("vk-broken")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("lists only keys whose name starts with the prefix, across pages", async () => {
    const bifrost = await keys();
    const all = [
      ...Array.from({ length: 100 }, (_, index) => listed(`vk-${String(index)}`, `macaron-run-${String(index)}`)),
      listed("vk-x", "not-macaron-run-x"),
      listed("vk-last", "macaron-run-last", false),
    ];
    server.use(
      http.get(`${ADMIN}/api/governance/virtual-keys`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("search")).toBe("macaron-run-");
        const offset = Number(url.searchParams.get("offset"));
        const limit = Number(url.searchParams.get("limit"));
        return HttpResponse.json({ virtual_keys: all.slice(offset, offset + limit), count: limit, total_count: all.length, limit, offset });
      }),
    );

    const found = await bifrost.listByPrefix("macaron-run-");

    expect(found).toHaveLength(101);
    expect(found.at(-1)).toEqual({ hash: "vk-last", name: "macaron-run-last", disabled: true, createdAt: new Date("2026-10-19T12:00:00Z") });
  });

  it("reads an empty listing, which Bifrost sends as null", async () => {
    const bifrost = await keys();
    server.use(
      http.get(`${ADMIN}/api/governance/virtual-keys`, () => HttpResponse.json({ count: 0, limit: 100, offset: 0, total_count: 0, virtual_keys: null })),
    );

    expect(await bifrost.listByPrefix("macaron-run-")).toEqual([]);
  });

  it("reads a key's spend from memory, summing its budgets", async () => {
    const bifrost = await keys();
    server.use(
      http.get(`${ADMIN}/api/governance/virtual-keys/vk-1`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("from_memory")).toBe("true");
        return HttpResponse.json({ virtual_key: { ...listed("vk-1", "macaron-run-r1"), budgets: [budget(0.243_758_8)] } });
      }),
    );

    expect(await bifrost.spentSince("vk-1", new Date())).toBeCloseTo(0.243_758_8, 9);
  });

  it("fails start-up when the admin API refuses its credentials", async () => {
    server.use(http.get(`${ADMIN}/api/models/details`, () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })));

    await expect(new BifrostKeys(settings).init()).rejects.toThrow(/list model prices failed \(HTTP 401\)/);
  });
});
