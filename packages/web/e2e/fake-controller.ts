/**
 * A stand-in for the controller's API, for the end-to-end tests only: in-memory, reset before each
 * test. Every request body and response it sends is checked against the Zod schemas generated
 * from the controller's OpenAPI document, so it can't drift from the real API.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { z } from "zod";
import {
  zApproveEndpointBody,
  zApproveEndpointResponse,
  zCreateInvitationBody,
  zCreateInvitationResponse,
  zGetMeResponse,
  zGetMyLlmKeyEventsResponse,
  zGetMyLlmKeyResponse,
  zGetMyMonthResponse,
  zGetMyUsageResponse,
  zListEndpointsResponse,
  zListInvitationsResponse,
  zListUsersResponse,
  zSaveMyLlmKeyBody,
  zSaveMyLlmKeyResponse,
  zSetMyMonthlyCapBody,
  zSetMyMonthlyCapResponse,
  zSetEndpointEnabledBody,
  zSetEndpointEnabledResponse,
  zSetUserCapabilitiesBody,
  zSetUserCapabilitiesResponse,
} from "../src/lib/server/controller/generated/zod.gen.ts";
import { PORTS } from "./ports.ts";

type User = z.infer<typeof zListUsersResponse>["users"][number];
type Invitation = z.infer<typeof zListInvitationsResponse>["invitations"][number];
type Endpoint = z.infer<typeof zListEndpointsResponse>["endpoints"][number];
type LlmKey = NonNullable<z.infer<typeof zGetMyLlmKeyResponse>["key"]>;
type LlmKeyEvent = z.infer<typeof zGetMyLlmKeyEventsResponse>["events"][number];
type Run = z.infer<typeof zGetMyUsageResponse>["runs"][number];

export const SESSION_COOKIE = "__Secure-macaron.session_token";
const DAY = 86_400_000;
const ALL: User["capabilities"] = ["triage", "plan", "implement", "reproduce", "verify", "review", "remember"];

interface State {
  users: User[];
  invitations: Invitation[];
  endpoints: Endpoint[];
  /** By user id. */
  keys: Map<string, LlmKey>;
  keyEvents: Map<string, LlmKeyEvent[]>;
  /** By user id; absent for no cap. */
  caps: Map<string, number>;
  runs: Run[];
  /** Session renewals the browser asked for (through the edge), counted for the session test. */
  renewals: number;
}

function fresh(): State {
  const now = Date.now();
  const at = (days: number): string => new Date(now + days * DAY).toISOString();
  const users: User[] = [
    { id: "usrAdmin01", githubId: 583231, githubLogin: "octocat", name: "The Octocat", avatarUrl: null, role: "admin", capabilities: ALL, createdAt: at(-40), lastSignInAt: at(0) },
    { id: "usrDefunkt", githubId: 2, githubLogin: "defunkt", name: "Chris Wanstrath", avatarUrl: null, role: "user", capabilities: ["review"], createdAt: at(-20), lastSignInAt: at(-2) },
  ];
  const invitations: Invitation[] = [
    { id: randomUUID(), githubId: 7, githubLogin: "hubot", capabilities: ["triage", "plan"], invitedBy: "octocat", createdAt: at(-1), expiresAt: at(6), status: "pending" },
  ];
  const endpoints: Endpoint[] = [
    { id: randomUUID(), name: "Anthropic API", baseUrl: "https://api.anthropic.com", enabled: true, pricingNote: null, createdBy: null, createdAt: at(-40) },
  ];
  const modes = ["review", "plan", "implement", "triage", "verify"];
  const runs: Run[] = Array.from({ length: 31 }, (_, i) => ({
    id: randomUUID(),
    repo: "open-macaron/macaron",
    number: 1200 + i,
    kind: i % 2 === 0 ? "issue" : "pull",
    mode: modes[i % modes.length] ?? "triage",
    status: i === 0 ? "running" : "completed",
    model: "claude-sonnet-5-5",
    costUsd: i === 0 ? null : 0.5,
    createdAt: at(-i / 10),
  }));
  return { users, invitations, endpoints, keys: new Map(), keyEvents: new Map(), caps: new Map(), runs, renewals: 0 };
}

let state = fresh();

interface Reply {
  readonly status: number;
  /** Already checked against its schema; undefined for 204. */
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/** An answer, checked against the API's schema first: a fake that drifts from the API fails the test that relies on it. */
function reply<T>(status: number, schema: z.ZodType<T> | undefined, body: T, headers: Readonly<Record<string, string>> = {}): Reply {
  return { status, body: schema === undefined ? body : schema.parse(body), headers };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The session cookie's value names the user in these tests: `octocat` (admin) or `defunkt`. */
function signedIn(request: IncomingMessage): User | undefined {
  const value = /__Secure-macaron\.session_token=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
  return state.users.find((user) => user.githubLogin === value);
}

const sessionCookie = (value: string, maxAge: number): string => `${SESSION_COOKIE}=${value}; Max-Age=${String(maxAge)}; Path=/; HttpOnly; Secure; SameSite=Lax`;

async function route(request: IncomingMessage): Promise<Reply> {
  const url = new URL(request.url ?? "/", "http://fake");
  const method = request.method ?? "GET";
  if (method === "POST" && url.pathname === "/__reset") {
    state = fresh();
    return reply(200, undefined, { reset: true });
  }
  if (url.pathname === "/__renewals") return reply(200, undefined, { renewals: state.renewals });

  const user = signedIn(request);
  if (url.pathname === "/api/auth/get-session") {
    if (user === undefined) return reply(200, undefined, null);
    const body = {
      session: { id: "s1", token: "t1", userId: user.id, expiresAt: new Date(Date.now() + 7 * DAY).toISOString(), createdAt: user.createdAt, updatedAt: user.createdAt },
      user: { id: user.id, name: user.name, email: `${user.githubLogin}@example.test`, emailVerified: false, image: null, githubId: user.githubId, githubLogin: user.githubLogin, role: user.role, createdAt: user.createdAt, updatedAt: user.createdAt },
    };
    // As better-auth does for a session last renewed over a day ago: a fresh 7-day cookie. Only the
    // browser's own call (through the edge) can pass it on.
    if (request.headers["x-through-edge"] === "1") {
      state.renewals += 1;
      return reply(200, undefined, body, { "set-cookie": sessionCookie(user.githubLogin, 604_800) });
    }
    return reply(200, undefined, body);
  }
  if (method === "POST" && url.pathname === "/api/auth/sign-out") return reply(200, undefined, { success: true }, { "set-cookie": sessionCookie("", 0) });

  if (user === undefined) return reply(401, undefined, { error: "sign_in_required" });
  if (url.pathname === "/v1/me") {
    return reply(200, zGetMeResponse, { githubId: user.githubId, githubLogin: user.githubLogin, name: user.name, avatarUrl: user.avatarUrl, role: user.role, capabilities: user.capabilities });
  }
  if (url.pathname === "/v1/me/usage") {
    const limit = Number(url.searchParams.get("limit") ?? "25");
    const before = url.searchParams.get("before");
    const start = before === null ? 0 : state.runs.findIndex((run) => run.id === before) + 1;
    const page = state.runs.slice(start, start + limit);
    const settled = state.runs.filter((run) => run.costUsd !== null);
    return reply(200, zGetMyUsageResponse, {
      runs: page,
      nextCursor: start + limit < state.runs.length ? (page.at(-1)?.id ?? null) : null,
      monthUsd: settled.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
      monthRuns: settled.length,
    });
  }
  if (url.pathname.startsWith("/v1/me/llm-key")) return llmKeyRoute(url, method, user, request);
  if (url.pathname === "/v1/me/month" || url.pathname === "/v1/me/monthly-cap") {
    if (method === "PUT") {
      const { monthlyCapUsd } = zSetMyMonthlyCapBody.parse(await readJson(request));
      if (monthlyCapUsd === null) state.caps.delete(user.id);
      else state.caps.set(user.id, monthlyCapUsd);
    }
    const spentUsd = state.runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    const reservedUsd = state.runs.filter((run) => run.costUsd === null).length * 2;
    return reply(200, method === "PUT" ? zSetMyMonthlyCapResponse : zGetMyMonthResponse, { monthlyCapUsd: state.caps.get(user.id) ?? null, spentUsd, reservedUsd });
  }
  if (user.role !== "admin") return reply(403, undefined, { error: "forbidden" });

  if (url.pathname === "/v1/admin/invitations" && method === "GET") return reply(200, zListInvitationsResponse, { invitations: state.invitations });
  if (url.pathname === "/v1/admin/invitations" && method === "POST") {
    const body = zCreateInvitationBody.parse(await readJson(request));
    if (body.githubLogin === "nobody") return reply(409, undefined, { error: "field_refused", field: "githubLogin", message: "No GitHub account is called @nobody." });
    if (state.invitations.some((invitation) => invitation.status === "pending" && invitation.githubLogin === body.githubLogin)) {
      return reply(409, undefined, { error: "field_refused", field: "githubLogin", message: `@${body.githubLogin} already has a pending invitation.` });
    }
    const invitation: Invitation = { id: randomUUID(), githubId: 900 + state.invitations.length, githubLogin: body.githubLogin, capabilities: body.capabilities, invitedBy: user.githubLogin, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * DAY).toISOString(), status: "pending" };
    state.invitations = [invitation, ...state.invitations];
    return reply(201, zCreateInvitationResponse, invitation);
  }
  const revoke = /^\/v1\/admin\/invitations\/([^/]+)\/revoke$/.exec(url.pathname);
  if (revoke !== null && method === "POST") {
    state.invitations = state.invitations.map((invitation) => (invitation.id === revoke[1] && invitation.status === "pending" ? { ...invitation, status: "revoked" } : invitation));
    return reply(204, undefined, undefined);
  }
  if (url.pathname === "/v1/admin/endpoints" && method === "GET") return reply(200, zListEndpointsResponse, { endpoints: state.endpoints });
  if (url.pathname === "/v1/admin/endpoints" && method === "POST") {
    const body = zApproveEndpointBody.parse(await readJson(request));
    // As the controller does for a host resolving to a private address.
    if (new URL(body.baseUrl).hostname.endsWith(".internal")) return reply(409, undefined, { error: "field_refused", field: "baseUrl", message: "This host resolves to a private or reserved address." });
    if (state.endpoints.some((endpoint) => endpoint.baseUrl === body.baseUrl)) return reply(409, undefined, { error: "field_refused", field: "baseUrl", message: "This base URL is already an endpoint." });
    const endpoint: Endpoint = { id: randomUUID(), name: body.name, baseUrl: body.baseUrl, enabled: true, pricingNote: body.pricingNote ?? null, createdBy: user.githubLogin, createdAt: new Date().toISOString() };
    state.endpoints = [...state.endpoints, endpoint];
    return reply(201, zApproveEndpointResponse, endpoint);
  }
  const enabled = /^\/v1\/admin\/endpoints\/([^/]+)\/enabled$/.exec(url.pathname);
  if (enabled !== null && method === "PUT") {
    const body = zSetEndpointEnabledBody.parse(await readJson(request));
    state.endpoints = state.endpoints.map((endpoint) => (endpoint.id === enabled[1] ? { ...endpoint, enabled: body.enabled } : endpoint));
    const updated = state.endpoints.find((endpoint) => endpoint.id === enabled[1]);
    if (updated === undefined) return reply(409, undefined, { error: "field_refused", field: "id", message: "This endpoint no longer exists." });
    return reply(200, zSetEndpointEnabledResponse, updated);
  }
  if (url.pathname === "/v1/admin/users") return reply(200, zListUsersResponse, { users: state.users });
  const capabilities = /^\/v1\/admin\/users\/([^/]+)\/capabilities$/.exec(url.pathname);
  if (capabilities !== null && method === "PUT") {
    const body = zSetUserCapabilitiesBody.parse(await readJson(request));
    state.users = state.users.map((candidate) => (candidate.id === capabilities[1] ? { ...candidate, capabilities: body.capabilities } : candidate));
    const updated = state.users.find((candidate) => candidate.id === capabilities[1]);
    if (updated === undefined) return reply(409, undefined, { error: "field_refused", field: "userId", message: "This user no longer exists." });
    return reply(200, zSetUserCapabilitiesResponse, updated);
  }
  return reply(404, undefined, { error: "not_found" });
}

/** In these tests octocat signed in a moment ago; defunkt's sign-in is too old to change a key. */
const freshUntil = (user: User): string => new Date(Date.now() + (user.githubLogin === "octocat" ? 10 : -1) * 60_000).toISOString();

function recordKeyEvent(user: User, event: Omit<LlmKeyEvent, "id" | "at" | "thread">): void {
  state.keyEvents.set(user.id, [{ id: randomUUID(), at: new Date().toISOString(), thread: null, ...event }, ...(state.keyEvents.get(user.id) ?? [])]);
}

async function llmKeyRoute(url: URL, method: string, user: User, request: IncomingMessage): Promise<Reply> {
  if (url.pathname === "/v1/me/llm-key/events") return reply(200, zGetMyLlmKeyEventsResponse, { events: state.keyEvents.get(user.id) ?? [], nextCursor: null });
  if (url.pathname !== "/v1/me/llm-key") return reply(404, undefined, { error: "not_found" });
  const enabled = state.endpoints.filter((endpoint) => endpoint.enabled);
  if (method === "GET") {
    const choices = enabled.map(({ id, name, baseUrl, pricingNote }) => ({ id, name, baseUrl, pricingNote }));
    return reply(200, zGetMyLlmKeyResponse, { key: state.keys.get(user.id) ?? null, endpoints: choices, storage: true, freshUntil: freshUntil(user) });
  }
  if (Date.parse(freshUntil(user)) < Date.now()) return reply(403, undefined, { error: "fresh_session_required" });
  if (method === "DELETE") {
    const previous = state.keys.get(user.id);
    state.keys.delete(user.id);
    if (previous !== undefined) recordKeyEvent(user, { kind: "deleted", endpointName: previous.endpoint.name, last4: previous.last4, detail: null });
    return reply(204, undefined, undefined);
  }
  if (method !== "PUT") return reply(404, undefined, { error: "not_found" });
  const body = zSaveMyLlmKeyBody.parse(await readJson(request));
  const endpoint = enabled.find((candidate) => candidate.id === body.endpointId);
  if (endpoint === undefined) return reply(409, undefined, { error: "field_refused", field: "endpointId", message: "Choose one of the endpoints in the list." });
  const last4 = body.key.slice(-4);
  // As an endpoint refusing a key: any key containing "wrong".
  if (body.key.includes("wrong")) {
    recordKeyEvent(user, { kind: "rejected", endpointName: endpoint.name, last4, detail: "HTTP 401" });
    return reply(409, undefined, { error: "field_refused", field: "key", message: `${endpoint.name} refused this key (HTTP 401). Check it, and that it's meant for this endpoint.` });
  }
  const previous = state.keys.get(user.id);
  const now = new Date().toISOString();
  const saved: LlmKey = {
    endpoint: { id: endpoint.id, name: endpoint.name, baseUrl: endpoint.baseUrl, pricingNote: endpoint.pricingNote, enabled: true },
    last4,
    status: "valid",
    validatedAt: now,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  state.keys.set(user.id, saved);
  recordKeyEvent(user, { kind: previous === undefined ? "created" : "replaced", endpointName: endpoint.name, last4, detail: previous === undefined ? null : `replaces the key ending in ${previous.last4}` });
  return reply(200, zSaveMyLlmKeyResponse, { key: saved, missingModels: ["claude-opus-5-5"] });
}

createServer((request, response) => {
  route(request)
    .catch((error: unknown): Reply => {
      console.error(error);
      return reply(500, undefined, { error: "fake_controller_failed" });
    })
    .then(({ status, body, headers }) => {
      response.writeHead(status, body === undefined ? headers : { "content-type": "application/json", ...headers });
      response.end(body === undefined ? undefined : JSON.stringify(body));
    }, (error: unknown) => {
      console.error(error);
    });
}).listen(PORTS.controller, "127.0.0.1", () => {
  console.info(`fake controller on ${String(PORTS.controller)}`);
});
