import { SaveLlmKey } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { probeEndpoint } from "../../src/keys/endpoint-probe.ts";

const KEY = "sk-ant-secret-0000000000001234";

/** A fetch answering `response`, remembering what it was asked. */
function endpoint(response: () => Response | Promise<Response>): { fetch: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fetch: (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : String(input), init });
      return Promise.resolve(response());
    },
  };
}

describe("probeEndpoint", () => {
  it("lists the models with the key in x-api-key, following no redirect", async () => {
    const fake = endpoint(() => Response.json({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-4-5" }], has_more: false }));
    expect(await probeEndpoint("https://api.example.com", KEY, fake.fetch)).toEqual({ outcome: "accepted", models: ["claude-sonnet-5-5", "claude-haiku-4-5"] });
    const [call] = fake.calls;
    expect(call?.url).toBe("https://api.example.com/v1/models?limit=1000");
    expect(call?.init?.redirect).toBe("manual");
    expect(new Headers(call?.init?.headers).get("x-api-key")).toBe(KEY);
    expect(new Headers(call?.init?.headers).get("authorization")).toBeNull();
  });

  it("reports a refused key", async () => {
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(() => new Response("{}", { status: 401 })).fetch)).toEqual({ outcome: "rejected", status: 401 });
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(() => new Response("{}", { status: 403 })).fetch)).toEqual({ outcome: "rejected", status: 403 });
  });

  it("reports an endpoint that redirects, fails, answers something else or nothing, without its answer", async () => {
    const redirect = await probeEndpoint("https://api.example.com", KEY, endpoint(() => new Response(null, { status: 307, headers: { location: "https://elsewhere.example" } })).fetch);
    expect(redirect).toEqual({ outcome: "unreachable", reason: "the endpoint answered with a redirect" });
    const failing = await probeEndpoint("https://api.example.com", KEY, endpoint(() => new Response(`upstream said: ${KEY}`, { status: 502 })).fetch);
    expect(failing).toEqual({ outcome: "unreachable", reason: "the endpoint answered HTTP 502" });
    const html = await probeEndpoint("https://api.example.com", KEY, endpoint(() => new Response("<html>login</html>", { status: 200 })).fetch);
    expect(html).toEqual({ outcome: "unreachable", reason: "the endpoint's answer isn't a model list" });
    const down = await probeEndpoint("https://api.example.com", KEY, () => Promise.reject(new TypeError("fetch failed")));
    expect(down).toEqual({ outcome: "unreachable", reason: "the endpoint couldn't be reached" });
    const slow = await probeEndpoint("https://api.example.com", KEY, () => Promise.reject(new DOMException("timed out", "TimeoutError")));
    expect(slow).toEqual({ outcome: "unreachable", reason: "no answer within 10 seconds" });
  });
});

describe("SaveLlmKey", () => {
  it("never repeats a refused key in its errors", () => {
    const result = SaveLlmKey.safeParse({ endpointId: "0a8c5f8e-7a51-4c8e-9a4e-3f1d2b6c7d8e", key: "sk-ant secret with spaces 1234" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("secret");
  });
});
