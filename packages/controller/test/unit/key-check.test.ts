import { SaveLlmKey } from "@open-macaron/contracts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { type HttpGet, NotPublicAddress, probeEndpoint, ProbeTimeout, publicHttpsGet, publicLookup } from "../../src/keys/key-check.ts";

const KEY = "sk-ant-secret-0000000000001234";

/** An endpoint answering `status` and `body`, remembering what it was asked. */
function endpoint(status: number, body: string): { get: HttpGet; calls: { url: string; headers: Readonly<Record<string, string>> }[] } {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  return {
    calls,
    get: (url, headers) => {
      calls.push({ url, headers });
      return Promise.resolve({ status, body });
    },
  };
}

function lookupOf(host: string): Promise<{ error: Error | null; address: unknown }> {
  return new Promise((resolve) => {
    publicLookup(host, { all: true }, (error, address) => {
      resolve({ error, address });
    });
  });
}

describe("probeEndpoint", () => {
  it("lists the models with the key in x-api-key", async () => {
    const fake = endpoint(200, JSON.stringify({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-4-5" }], has_more: false }));
    expect(await probeEndpoint("https://api.example.com", KEY, fake.get)).toEqual({ outcome: "accepted", models: ["claude-sonnet-5-5", "claude-haiku-4-5"] });
    expect(fake.calls).toEqual([{ url: "https://api.example.com/v1/models?limit=1000", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", accept: "application/json" } }]);
  });

  it("reports a refused key", async () => {
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(401, "{}").get)).toEqual({ outcome: "rejected", status: 401 });
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(403, "{}").get)).toEqual({ outcome: "rejected", status: 403 });
  });

  it("reports an endpoint that redirects, fails, answers something else or nothing, without its answer", async () => {
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(307, "").get)).toEqual({ outcome: "unreachable", reason: "the endpoint answered with a redirect" });
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(502, `upstream said: ${KEY}`).get)).toEqual({ outcome: "unreachable", reason: "the endpoint answered HTTP 502" });
    expect(await probeEndpoint("https://api.example.com", KEY, endpoint(200, "<html>login</html>").get)).toEqual({ outcome: "unreachable", reason: "the endpoint's answer isn't a model list" });
    const failing = (error: Error): HttpGet => () => Promise.reject(error);
    expect(await probeEndpoint("https://api.example.com", KEY, failing(new Error("ECONNREFUSED")))).toEqual({ outcome: "unreachable", reason: "the endpoint couldn't be reached" });
    expect(await probeEndpoint("https://api.example.com", KEY, failing(new ProbeTimeout()))).toEqual({ outcome: "unreachable", reason: "no answer within 10 seconds" });
    expect(await probeEndpoint("https://api.example.com", KEY, failing(new NotPublicAddress("x")))).toEqual({ outcome: "unreachable", reason: "its host now resolves to a private or reserved address" });
  });
});

describe("publicHttpsGet", () => {
  it("never connects to a private address, whatever DNS answered before", async () => {
    // A server on loopback: the connection's own lookup refuses it before any byte is sent.
    let reached = false;
    const server = createServer((_request, response) => {
      reached = true;
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port }: AddressInfo = tcpAddress(server.address());
    await expect(publicHttpsGet(`https://localhost:${String(port)}/v1/models`, { "x-api-key": KEY })).rejects.toBeInstanceOf(NotPublicAddress);
    expect(reached).toBe(false);
    server.close();
  });

  it("refuses a host resolving to loopback", async () => {
    expect((await lookupOf("localhost")).error).toBeInstanceOf(NotPublicAddress);
  });
});

describe("SaveLlmKey", () => {
  it("never repeats a refused key in its errors", () => {
    const result = SaveLlmKey.safeParse({ endpointId: "0a8c5f8e-7a51-4c8e-9a4e-3f1d2b6c7d8e", key: "sk-ant secret with spaces 1234" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("secret");
  });
});

function tcpAddress(address: string | AddressInfo | null): AddressInfo {
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return address;
}
