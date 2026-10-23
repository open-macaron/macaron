import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { BifrostKeys } from "../../src/budget/bifrost-keys.ts";
import { PriceList } from "../../src/budget/price-list.ts";
import { UpstreamError } from "../../src/common/errors.ts";
import type { BifrostEnv } from "../../src/config/env.ts";

const ADMIN = "http://bifrost.internal.test:8080";
const settings: BifrostEnv = {
  adminUrl: ADMIN,
  publicUrl: "https://macaron.example.test/llm/anthropic",
  username: "macaron",
  password: "admin-password-0000000000",
  pricingFile: "/unused",
  requestsPerMinute: 60,
};
const prices = PriceList.of(
  new Map([
    ["claude-sonnet-5-5", { input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5, cache_read_input_token_cost: 3e-7 }],
    ["claude-haiku-4-5", { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 }],
  ]),
);
const ENDPOINT = "0a8c5f8e-7a51-4c8e-9a4e-3f1d2b6c7d8e";
const PROVIDER = `macaron-ep-${ENDPOINT}`;
const USER_KEY = "sk-ant-user-secret-0000001234";
const upstream = { endpointId: ENDPOINT, baseUrl: "https://gateway.example.com", key: USER_KEY };
const AT = "2026-10-19T12:00:00Z";

/** Bifrost's admin API, as far as BifrostKeys uses it: providers, their keys, price overrides, virtual keys. */
interface FakeBifrost {
  providers: Map<string, { baseUrl: string; keys: Map<string, { name: string; value: string }> }>;
  overrides: { id: string; pattern: string; provider: string; patch: Record<string, number> }[];
  virtualKeys: Map<string, { name: string; active: boolean; provider: string; keyIds: string[]; usage: number }>;
  calls: string[];
  bodies: Map<string, unknown>;
  failVirtualKey: boolean;
}
let bifrost: FakeBifrost;

const Body = z.record(z.string(), z.unknown());
const ProviderBody = z.object({ provider: z.string(), network_config: z.object({ base_url: z.string() }) });
const KeyBody = z.object({ id: z.string(), name: z.string(), value: z.string() });
const OverrideBody = z.object({ pattern: z.string(), provider_id: z.string(), patch: z.record(z.string(), z.number()) });
const VirtualKeyBody = z.object({ name: z.string(), provider_configs: z.array(z.object({ provider: z.string(), key_ids: z.array(z.string()) })) });

function virtualKey(id: string) {
  const vk = bifrost.virtualKeys.get(id);
  if (vk === undefined) return undefined;
  const at = AT;
  return {
    id,
    name: vk.name,
    value: "sk-bf-hidden",
    is_active: vk.active,
    provider_configs: [{ provider: vk.provider }],
    mcp_configs: [],
    calendar_aligned: false,
    config_hash: "h",
    created_at: at,
    updated_at: at,
    budgets: [{ id: "b-1", max_limit: 0.5, reset_duration: "1Y", last_reset: at, current_usage: vk.usage, config_hash: null, created_at: at, updated_at: at }],
  };
}

const server = setupServer(
  http.get(`${ADMIN}/api/providers`, () => HttpResponse.json({ providers: [...bifrost.providers.keys()].map((name) => ({ name })), total: bifrost.providers.size })),
  http.get(`${ADMIN}/api/providers/:provider`, ({ params }) => {
    const provider = bifrost.providers.get(String(params["provider"]));
    return provider === undefined ? HttpResponse.json({ error: "not found" }, { status: 404 }) : HttpResponse.json({ name: params["provider"], network_config: { base_url: provider.baseUrl } });
  }),
  http.post(`${ADMIN}/api/providers`, async ({ request }) => {
    const raw: unknown = await request.json();
    const body = ProviderBody.parse(raw);
    bifrost.calls.push(`create provider ${body.provider}`);
    bifrost.bodies.set("provider", raw);
    bifrost.providers.set(body.provider, { baseUrl: body.network_config.base_url, keys: new Map() });
    return HttpResponse.json({ name: body.provider });
  }),
  http.get(`${ADMIN}/api/providers/:provider/keys`, ({ params }) => {
    const provider = bifrost.providers.get(String(params["provider"]));
    const keys = [...(provider?.keys.entries() ?? [])].map(([id, key]) => ({ id, name: key.name }));
    // As Bifrost does: an empty list is null.
    return HttpResponse.json({ keys: keys.length === 0 ? null : keys, total: keys.length });
  }),
  http.post(`${ADMIN}/api/providers/:provider/keys`, async ({ params, request }) => {
    const body = KeyBody.parse(await request.json());
    const provider = bifrost.providers.get(String(params["provider"]));
    if (provider === undefined) return HttpResponse.json({ error: "not found" }, { status: 404 });
    bifrost.calls.push(`add key ${body.id}`);
    provider.keys.set(body.id, { name: body.name, value: body.value });
    return HttpResponse.json({ id: body.id, name: body.name });
  }),
  http.delete(`${ADMIN}/api/providers/:provider/keys/:key`, ({ params }) => {
    const provider = bifrost.providers.get(String(params["provider"]));
    if (provider?.keys.delete(String(params["key"])) !== true) return HttpResponse.json({ error: "not found" }, { status: 404 });
    bifrost.calls.push(`delete key ${String(params["key"])}`);
    return HttpResponse.json({ message: "deleted" });
  }),
  http.get(`${ADMIN}/api/governance/pricing-overrides`, ({ request }) => {
    const provider = new URL(request.url).searchParams.get("provider_id");
    return HttpResponse.json({ pricing_overrides: bifrost.overrides.filter((override) => override.provider === provider).map(({ id, pattern, patch }) => ({ id, pattern, patch })) });
  }),
  http.post(`${ADMIN}/api/governance/pricing-overrides`, async ({ request }) => {
    const body = OverrideBody.parse(await request.json());
    bifrost.calls.push(`price ${body.pattern}`);
    bifrost.overrides.push({ id: `po-${body.pattern}`, pattern: body.pattern, provider: body.provider_id, patch: body.patch });
    return HttpResponse.json({ message: "created" }, { status: 201 });
  }),
  http.put(`${ADMIN}/api/governance/pricing-overrides/:id`, async ({ params, request }) => {
    const body = z.object({ patch: z.record(z.string(), z.number()) }).parse(await request.json());
    const override = bifrost.overrides.find((candidate) => candidate.id === params["id"]);
    if (override !== undefined) override.patch = body.patch;
    bifrost.calls.push(`reprice ${String(params["id"])}`);
    return HttpResponse.json({ message: "updated" });
  }),
  http.post(`${ADMIN}/api/governance/virtual-keys`, async ({ request }) => {
    const raw: unknown = await request.json();
    if (bifrost.failVirtualKey) return HttpResponse.json({ error: `bad request for ${USER_KEY}` }, { status: 400 });
    const body = VirtualKeyBody.parse(raw);
    const [config] = body.provider_configs;
    bifrost.bodies.set("virtual key", raw);
    bifrost.virtualKeys.set("vk-1", { name: body.name, active: true, provider: config?.provider ?? "", keyIds: config?.key_ids ?? [], usage: 0 });
    return HttpResponse.json({ message: "created", virtual_key: { ...virtualKey("vk-1"), value: "sk-bf-run-key" } });
  }),
  http.get(`${ADMIN}/api/governance/virtual-keys/:id`, ({ params }) => {
    const vk = virtualKey(String(params["id"]));
    return vk === undefined ? HttpResponse.json({ error: "not found" }, { status: 404 }) : HttpResponse.json({ virtual_key: vk });
  }),
  http.put(`${ADMIN}/api/governance/virtual-keys/:id`, async ({ params, request }) => {
    const body = Body.parse(await request.json());
    const vk = bifrost.virtualKeys.get(String(params["id"]));
    if (vk === undefined) return HttpResponse.json({ error: "not found" }, { status: 404 });
    if (body["is_active"] === false) vk.active = false;
    return HttpResponse.json({ message: "updated" });
  }),
  http.delete(`${ADMIN}/api/governance/virtual-keys/:id`, ({ params }) => {
    if (!bifrost.virtualKeys.delete(String(params["id"]))) return HttpResponse.json({ error: "not found" }, { status: 404 });
    bifrost.calls.push(`delete virtual key ${String(params["id"])}`);
    return HttpResponse.json({ message: "deleted" });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  bifrost = { providers: new Map(), overrides: [], virtualKeys: new Map(), calls: [], bodies: new Map(), failVirtualKey: false };
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const keys = (): BifrostKeys => new BifrostKeys(settings, prices);
const expires = new Date("2026-10-19T13:15:00Z");

describe("BifrostKeys.create", () => {
  it("creates the endpoint's provider and prices, adds the user's key for this run, and binds the virtual key to it alone", async () => {
    const key = await keys().create("macaron-run-r1", 0.5, expires, ["claude-sonnet-5-5", "claude-haiku-4-5", "claude-sonnet-5-5"], upstream);

    expect(key).toEqual({ key: "sk-bf-run-key", hash: "vk-1" });
    expect(bifrost.calls).toEqual([`create provider ${PROVIDER}`, "price claude-sonnet-5-5", "price claude-haiku-4-5", "add key macaron-run-r1"]);
    expect(bifrost.bodies.get("provider")).toEqual({
      provider: PROVIDER,
      network_config: { base_url: "https://gateway.example.com" },
      concurrency_and_buffer_size: { concurrency: 16, buffer_size: 16 },
      custom_provider_config: { base_provider_type: "anthropic", allowed_requests: { responses: true, responses_stream: true, count_tokens: true, list_models: true } },
    });
    expect(bifrost.overrides.find((override) => override.pattern === "claude-sonnet-5-5")?.patch).toEqual({ input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5, cache_read_input_token_cost: 3e-7 });
    expect(bifrost.providers.get(PROVIDER)?.keys.get("macaron-run-r1")?.value).toBe(USER_KEY);
    expect(bifrost.bodies.get("virtual key")).toEqual({
      name: "macaron-run-r1",
      provider_configs: [{ provider: PROVIDER, allowed_models: ["claude-sonnet-5-5", "claude-haiku-4-5"], key_ids: ["macaron-run-r1"] }],
      budgets: [{ max_limit: 0.5, reset_duration: "1Y" }],
      rate_limit: { request_max_limit: 60, request_reset_duration: "1m" },
      expires_at: "2026-10-19T13:15:00.000Z",
      delete_after_expire: false,
      disable_content_logging: true,
    });
  });

  it("reuses the endpoint's provider and prices, bringing a changed price back to the pinned one", async () => {
    bifrost.providers.set(PROVIDER, { baseUrl: "https://gateway.example.com/", keys: new Map() });
    bifrost.overrides.push({ id: "po-1", pattern: "claude-haiku-4-5", provider: PROVIDER, patch: { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 } });
    bifrost.overrides.push({ id: "po-2", pattern: "claude-sonnet-5-5", provider: PROVIDER, patch: { input_cost_per_token: 1e-9, output_cost_per_token: 1e-9 } });

    await keys().create("macaron-run-r2", 0.5, expires, ["claude-sonnet-5-5", "claude-haiku-4-5"], upstream);

    expect(bifrost.calls).toEqual(["reprice po-2", "add key macaron-run-r2"]);
  });

  it("refuses an endpoint whose provider points at another host", async () => {
    bifrost.providers.set(PROVIDER, { baseUrl: "https://elsewhere.example.com", keys: new Map() });
    await expect(keys().create("macaron-run-r3", 0.5, expires, ["claude-haiku-4-5"], upstream)).rejects.toThrow(/points at https:\/\/elsewhere/);
    expect(bifrost.providers.get(PROVIDER)?.keys.size).toBe(0);
  });

  it("refuses a model without a pinned price before calling Bifrost", async () => {
    await expect(keys().create("macaron-run-r4", 0.5, expires, ["claude-haiku-4-5", "vendor/unpriced"], upstream)).rejects.toThrow(/no price for vendor\/unpriced/);
    expect(bifrost.calls).toEqual([]);
  });

  it("removes the user's key when the virtual key can't be created, and never repeats Bifrost's answer", async () => {
    bifrost.failVirtualKey = true;
    const failure = await keys()
      .create("macaron-run-r5", 0.5, expires, ["claude-haiku-4-5"], upstream)
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect(String(failure)).not.toContain(USER_KEY);
    expect(bifrost.providers.get(PROVIDER)?.keys.size).toBe(0);
  });
});

describe("BifrostKeys after a run", () => {
  async function minted(): Promise<BifrostKeys> {
    const bifrostKeys = keys();
    await bifrostKeys.create("macaron-run-r6", 0.5, expires, ["claude-haiku-4-5"], upstream);
    return bifrostKeys;
  }

  it("disabling stops the virtual key and takes the user's key out of Bifrost at once", async () => {
    const bifrostKeys = await minted();
    await bifrostKeys.disable("vk-1");
    expect(bifrost.virtualKeys.get("vk-1")?.active).toBe(false);
    expect(bifrost.providers.get(PROVIDER)?.keys.size).toBe(0);
  });

  it("reads the spend from the virtual key, still there after the user's key left", async () => {
    const bifrostKeys = await minted();
    await bifrostKeys.disable("vk-1");
    const vk = bifrost.virtualKeys.get("vk-1");
    if (vk !== undefined) vk.usage = 0.243_758_8;
    expect(await bifrostKeys.spentSince("vk-1", new Date())).toBeCloseTo(0.243_758_8, 9);
  });

  it("deletes both, and a key already gone is done", async () => {
    const bifrostKeys = await minted();
    await bifrostKeys.delete("vk-1");
    expect(bifrost.virtualKeys.size).toBe(0);
    expect(bifrost.providers.get(PROVIDER)?.keys.size).toBe(0);
    await expect(bifrostKeys.delete("vk-1")).resolves.toBeUndefined();
  });

  it("sweeps users' keys no run is settling, keeping the others", async () => {
    const bifrostKeys = await minted();
    bifrost.providers.get(PROVIDER)?.keys.set("macaron-run-orphan", { name: "macaron-run-orphan", value: "sk-left-behind" });
    bifrost.providers.set("anthropic", { baseUrl: "https://api.anthropic.com", keys: new Map([["upstream", { name: "upstream", value: "x" }]]) });

    expect(await bifrostKeys.sweepUpstreamKeys("macaron-run-", new Set(["macaron-run-r6"]))).toEqual(["macaron-run-orphan"]);
    expect([...(bifrost.providers.get(PROVIDER)?.keys.keys() ?? [])]).toEqual(["macaron-run-r6"]);
    expect(bifrost.providers.get("anthropic")?.keys.size).toBe(1);
  });
});

describe("BifrostKeys.init", () => {
  it("fails start-up when the admin API refuses its credentials", async () => {
    server.use(http.get(`${ADMIN}/api/providers`, () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })));
    await expect(keys().init()).rejects.toThrow(/list providers failed \(HTTP 401\)/);
  });
});
