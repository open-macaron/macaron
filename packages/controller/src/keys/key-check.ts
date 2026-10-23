import { lookup as dnsLookup } from "node:dns";
import { get } from "node:https";
import type { LookupFunction } from "node:net";
import { z } from "zod";
import { isPublicAddress } from "../endpoints/public-address.ts";

/** What an endpoint said of a key, with nothing of the key or the endpoint's answer in it. */
export type ProbeResult =
  | { readonly outcome: "accepted"; readonly models: readonly string[] }
  | { readonly outcome: "rejected"; readonly status: number }
  | { readonly outcome: "unreachable"; readonly reason: string };

/** Checks a key against an endpoint; a token so tests answer for the endpoint. */
export type Probe = (baseUrl: string, key: string) => Promise<ProbeResult>;
export const PROBE = Symbol("PROBE");

/** One GET: its status and body, or a rejection (unreachable, too slow, refused address). */
export type HttpGet = (url: string, headers: Readonly<Record<string, string>>) => Promise<{ readonly status: number; readonly body: string }>;

/** The host resolved to an address keys must never be sent to. */
export class NotPublicAddress extends Error {
  override readonly name = "NotPublicAddress";
}

export class ProbeTimeout extends Error {
  override readonly name = "ProbeTimeout";
}

const ModelList = z.object({ data: z.array(z.object({ id: z.string() })) });
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;

/**
 * Resolves like the system does, then refuses unless every address is public. Given to the
 * connection itself, so the addresses checked are the ones connected to: a DNS answer can't
 * change in between.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error !== null) {
      callback(error, "", 4);
      return;
    }
    const [first] = addresses;
    if (first === undefined || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new NotPublicAddress(`${hostname} resolves to a private or reserved address`), "", 4);
      return;
    }
    if (options.all === true) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
};

/** node:https, connecting only to public addresses, following no redirect, bounded in time and size. */
export const publicHttpsGet: HttpGet = (url, headers) =>
  new Promise((resolve, reject) => {
    const request = get(url, { headers, lookup: publicLookup }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) request.destroy(new Error("answer too large"));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", reject);
    });
    const deadline = setTimeout(() => request.destroy(new ProbeTimeout()), TIMEOUT_MS);
    request.on("close", () => {
      clearTimeout(deadline);
    });
    request.on("error", reject);
  });

/**
 * Lists the endpoint's models with the key (Anthropic's `GET /v1/models`, the call Claude Code
 * makes too). The key goes to the approved host only: no redirect is followed.
 */
export async function probeEndpoint(baseUrl: string, key: string, httpGet: HttpGet = publicHttpsGet): Promise<ProbeResult> {
  let answer: { readonly status: number; readonly body: string };
  try {
    answer = await httpGet(`${baseUrl}/v1/models?limit=1000`, { "x-api-key": key, "anthropic-version": "2023-06-01", accept: "application/json" });
  } catch (error) {
    if (error instanceof ProbeTimeout) return { outcome: "unreachable", reason: "no answer within 10 seconds" };
    if (error instanceof NotPublicAddress) return { outcome: "unreachable", reason: "its host now resolves to a private or reserved address" };
    return { outcome: "unreachable", reason: "the endpoint couldn't be reached" };
  }
  if (answer.status === 401 || answer.status === 403) return { outcome: "rejected", status: answer.status };
  if (answer.status >= 300 && answer.status < 400) return { outcome: "unreachable", reason: "the endpoint answered with a redirect" };
  if (answer.status < 200 || answer.status >= 300) return { outcome: "unreachable", reason: `the endpoint answered HTTP ${String(answer.status)}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.body);
  } catch {
    parsed = undefined;
  }
  const list = ModelList.safeParse(parsed);
  if (!list.success) return { outcome: "unreachable", reason: "the endpoint's answer isn't a model list" };
  return { outcome: "accepted", models: list.data.data.map((model) => model.id) };
}
