/**
 * A stand-in for the controller's API, for the end-to-end tests only: in-memory, reset before each
 * test. Every request body and response it sends is checked against the Zod schemas generated
 * from the controller's OpenAPI document, so it can't drift from the real API.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { DEFAULT_MONTHLY_TOKEN_CAP } from "@open-macaron/contracts";
import type { z } from "zod";
import {
  zApproveEndpointBody,
  zApproveEndpointResponse,
  zCreateInvitationBody,
  zCreateInvitationResponse,
  zGetMeResponse,
  zGetMyLlmKeyEventsResponse,
  zGetMyLlmKeyResponse,
  zGetMyModelsResponse,
  zGetMyMonthResponse,
  zGetMyUsageResponse,
  zGetModelStatsResponse,
  zListEndpointsResponse,
  zListInvitationsResponse,
  zListProjectsResponse,
  zListRefusalsResponse,
  zListRunsResponse,
  zListUsersResponse,
  zSaveMyLlmKeyBody,
  zSaveMyLlmKeyResponse,
  zSetMyMonthlyCapBody,
  zSetMyMonthlyCapResponse,
  zSetMyMonthlyTokenCapBody,
  zSetMyMonthlyTokenCapResponse,
  zSetMyModelsBody,
  zSetMyModelsResponse,
  zSetEndpointEnabledBody,
  zSetEndpointEnabledResponse,
  zSetUserCapabilitiesBody,
  zSetUserCapabilitiesResponse,
} from "../src/lib/server/controller/generated/zod.gen.ts";
import { PORTS } from "./ports.ts";
import { FREE, PRICED } from "./pricing.ts";

type User = z.infer<typeof zListUsersResponse>["users"][number];
type Invitation = z.infer<typeof zListInvitationsResponse>["invitations"][number];
type Endpoint = z.infer<typeof zListEndpointsResponse>["endpoints"][number];
type LlmKey = NonNullable<z.infer<typeof zGetMyLlmKeyResponse>["key"]>;
type LlmKeyEvent = z.infer<typeof zGetMyLlmKeyEventsResponse>["events"][number];
type Run = z.infer<typeof zGetMyUsageResponse>["runs"][number];
type AdminRun = z.infer<typeof zListRunsResponse>["runs"][number];
type Refusal = z.infer<typeof zListRefusalsResponse>["refusals"][number];
type Preference = z.infer<typeof zSetMyModelsBody>["preference"];


export const SESSION_COOKIE = "__Secure-macaron.session_token";
const DAY = 86_400_000;
/** One page and a bit of /v1/projects: a project without repositories, a repository not ready, then ready ones. */
const PROJECT_ROWS: z.infer<typeof zListProjectsResponse>["rows"] = [
  { project: "empty-project", repo: null, fork: null },
  { project: "sandbox", repo: "open-macaron/sandbox-b", fork: null },
  ...Array.from({ length: 28 }, (_, index) => ({ project: "sandbox", repo: `open-macaron/repo-${String(index)}`, fork: `macaron-bot/x1y2z3-repo-${String(index)}` })),
];
const ALL: User["capabilities"] = ["triage", "plan", "implement", "reproduce", "verify", "review", "remember"];

interface State {
  users: User[];
  invitations: Invitation[];
  endpoints: Endpoint[];
  /** By user id. */
  keys: Map<string, LlmKey>;
  /** Each user's model picks. */
  preferences: Map<string, Preference>;
  keyEvents: Map<string, LlmKeyEvent[]>;
  /** By user id; absent for no cap. */
  caps: Map<string, number>;
  /** Users who changed their token cap; the others have the default. */
  tokenCaps: Map<string, number | null>;
  /** defunkt's runs: what /v1/me/usage lists. */
  runs: Run[];
  /** Everyone's, newest first: what /v1/admin/runs lists. */
  adminRuns: AdminRun[];
  refusals: Refusal[];
  /** By user id: when each closed the onboarding. /__forget-onboarding removes one. */
  onboarded: Map<string, string>;
  /** Set by /__break-projects: /v1/projects answers 500. */
  projectsBroken: boolean;
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
    tokensUsed: i === 0 ? null : 1_250_000,
    createdAt: at(-i / 10),
  }));
  const defunkt = { githubId: 2, login: "defunkt", name: "Chris Wanstrath", avatarUrl: null, hasAccount: true };
  const details = (run: Run, asker: AdminRun["asker"]): AdminRun => ({
    ...run,
    asker,
    triggerUrl: `https://github.com/${run.repo}/issues/${String(run.number)}#issuecomment-${String(run.number)}`,
    instruction: `@macaron-bot ${run.mode}`,
    runUrl: `https://github.com/open-macaron/runner/actions/runs/${String(run.number)}`,
    prNumber: null,
    limitUsd: 2,
    failure: null,
    finishedAt: run.costUsd === null ? null : run.createdAt,
  });
  const adminRuns: AdminRun[] = [
    details(
      { id: randomUUID(), repo: "open-macaron/sandbox", number: 7, kind: "issue", mode: "implement", status: "failed", model: "claude-opus-5-5", costUsd: 1.25, tokensUsed: 3_400_000, createdAt: at(0) },
      { githubId: 583231, login: "octocat", name: "The Octocat", avatarUrl: null, hasAccount: true },
    ),
    details(
      { id: randomUUID(), repo: "open-macaron/sandbox", number: 8, kind: "pull", mode: "address_review", status: "completed", model: "claude-sonnet-5-5", costUsd: 0.4, tokensUsed: 2_000, createdAt: at(-0.05) },
      { githubId: 9001, login: "review-bot", name: null, avatarUrl: null, hasAccount: false },
    ),
    ...runs.map((run) => details(run, defunkt)),
  ].map((run) => (run.number === 7 ? { ...run, failure: "the agent ran out of turns before finishing", prNumber: 9 } : run));
  const refusals: Refusal[] = [
    { id: randomUUID(), repo: "open-macaron/sandbox", number: 11, kind: "issue", author: "defunkt", authorId: 2, url: "https://github.com/open-macaron/sandbox/issues/11#issuecomment-1", reason: "@defunkt may not ask for implement: an admin grants it on the Users page", createdAt: at(-0.2) },
    { id: randomUUID(), repo: "open-macaron/macaron", number: 12, kind: "pull", author: "octocat", authorId: 583231, url: "https://github.com/open-macaron/macaron/pull/12#issuecomment-2", reason: null, createdAt: at(-3) },
  ];
  return { users, invitations, endpoints, keys: new Map(), preferences: new Map(), keyEvents: new Map(), caps: new Map(), tokenCaps: new Map(), runs, adminRuns, refusals, onboarded: new Map(users.map((user) => [user.id, user.createdAt])), projectsBroken: false, renewals: 0 };
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

/** The user named by `login` hasn't closed the onboarding anymore. */
function forgetOnboarding(login: string | null): User | undefined {
  const user = state.users.find((candidate) => candidate.githubLogin === login);
  if (user !== undefined) state.onboarded.delete(user.id);
  return user;
}

async function route(request: IncomingMessage): Promise<Reply> {
  const url = new URL(request.url ?? "/", "http://fake");
  const method = request.method ?? "GET";
  if (method === "POST" && url.pathname === "/__reset") {
    state = fresh();
    return reply(200, undefined, { reset: true });
  }
  if (method === "POST" && url.pathname === "/__break-projects") {
    state.projectsBroken = true;
    return reply(200, undefined, { broken: true });
  }
  if (url.pathname === "/__renewals") return reply(200, undefined, { renewals: state.renewals });
  if (method === "POST" && url.pathname === "/__forget-onboarding") {
    forgetOnboarding(url.searchParams.get("as"));
    return reply(200, undefined, { forgotten: true });
  }

  // For `pnpm dev:fake` only: the dev server proxies /api/auth here, so this sets the session cookie
  // on its origin. `as` names a fake user.
  if (url.pathname === "/api/auth/__dev-sign-in") {
    // Signed in afresh: the onboarding opens, as at a first sign-in.
    const as = forgetOnboarding(url.searchParams.get("as") ?? "defunkt")?.githubLogin ?? "defunkt";
    return reply(302, undefined, undefined, { "set-cookie": sessionCookie(as, 604_800), location: "/" });
  }

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
    return reply(200, zGetMeResponse, { githubId: user.githubId, githubLogin: user.githubLogin, name: user.name, avatarUrl: user.avatarUrl, role: user.role, capabilities: user.capabilities, onboardedAt: state.onboarded.get(user.id) ?? null });
  }
  if (method === "PUT" && url.pathname === "/v1/me/onboarding") {
    if (!state.onboarded.has(user.id)) state.onboarded.set(user.id, new Date().toISOString());
    return reply(204, undefined, undefined);
  }
  if (url.pathname === "/v1/projects") {
    if (state.projectsBroken) return reply(500, undefined, { error: "internal" });
    const after = url.searchParams.get("after");
    const start = after === null ? 0 : Number(after);
    const limit = Number(url.searchParams.get("limit") ?? "25");
    const end = start + limit;
    return reply(200, zListProjectsResponse, { rows: PROJECT_ROWS.slice(start, end), nextCursor: end < PROJECT_ROWS.length ? String(end) : null });
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
  if (url.pathname === "/v1/me/models") {
    if (method === "PUT") {
      const { preference } = zSetMyModelsBody.parse(await readJson(request));
      const refused = (field: string, model: string | undefined): Reply | undefined => (model === undefined || PRICED.includes(model) ? undefined : reply(409, undefined, { error: "field_refused", field, message: `${model} has no pinned price and isn't marked free, so nothing could cap a run on it.` }));
      const refusal = refused("model", preference.model) ?? refused("fastModel", preference.fastModel);
      if (refusal !== undefined) return refusal;
      state.preferences.set(user.id, preference);
    }
    return reply(200, method === "PUT" ? zSetMyModelsResponse : zGetMyModelsResponse, { models: PRICED, free: FREE, preference: state.preferences.get(user.id) ?? {} });
  }
  if (url.pathname === "/v1/me/month" || url.pathname === "/v1/me/monthly-cap" || url.pathname === "/v1/me/monthly-token-cap") {
    if (method === "PUT" && url.pathname === "/v1/me/monthly-cap") {
      const { monthlyCapUsd } = zSetMyMonthlyCapBody.parse(await readJson(request));
      if (monthlyCapUsd === null) state.caps.delete(user.id);
      else state.caps.set(user.id, monthlyCapUsd);
    }
    if (method === "PUT" && url.pathname === "/v1/me/monthly-token-cap") state.tokenCaps.set(user.id, zSetMyMonthlyTokenCapBody.parse(await readJson(request)).monthlyTokenCap);
    const spentUsd = state.runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    const reservedUsd = state.runs.filter((run) => run.costUsd === null).length * 2;
    const monthlyTokenCap = state.tokenCaps.has(user.id) ? (state.tokenCaps.get(user.id) ?? null) : DEFAULT_MONTHLY_TOKEN_CAP;
    const month = { monthlyCapUsd: state.caps.get(user.id) ?? null, spentUsd, reservedUsd, monthlyTokenCap, tokensUsed: 120_000_000, tokensReserved: 0 };
    if (method !== "PUT") return reply(200, zGetMyMonthResponse, month);
    return reply(200, url.pathname === "/v1/me/monthly-cap" ? zSetMyMonthlyCapResponse : zSetMyMonthlyTokenCapResponse, month);
  }
  if (user.role !== "admin") return reply(403, undefined, { error: "forbidden" });

  if (url.pathname === "/v1/admin/models") return reply(200, zGetModelStatsResponse, modelStats(url.searchParams.get("range") ?? "30d"));

  if (url.pathname === "/v1/admin/runs") {
    const { user: asker, repo, status, mode } = Object.fromEntries(url.searchParams);
    const matching = state.adminRuns.filter((run) => (asker === undefined || String(run.asker.githubId) === asker) && (repo === undefined || run.repo === repo) && (status === undefined || run.status === status) && (mode === undefined || run.mode === mode));
    const { page, nextCursor } = paged(matching, url);
    return reply(200, zListRunsResponse, {
      runs: page,
      nextCursor,
      monthUsd: matching.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
      monthRuns: matching.length,
      monthFailed: matching.filter((run) => run.status === "failed").length,
    });
  }
  if (url.pathname === "/v1/admin/refusals") {
    const { user: asker, repo } = Object.fromEntries(url.searchParams);
    const matching = state.refusals.filter((refusal) => (asker === undefined || String(refusal.authorId) === asker) && (repo === undefined || refusal.repo === repo));
    const { page, nextCursor } = paged(matching, url);
    return reply(200, zListRefusalsResponse, { refusals: page, nextCursor });
  }
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

/** A page of a newest-first list; the cursor is the last row's id. */
function paged<T extends { readonly id: string }>(rows: readonly T[], url: URL): { page: T[]; nextCursor: string | null } {
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const before = url.searchParams.get("before");
  const start = before === null ? 0 : rows.findIndex((row) => row.id === before) + 1;
  const page = rows.slice(start, start + limit);
  return { page, nextCursor: start + limit < rows.length ? (page.at(-1)?.id ?? null) : null };
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

/** Each model's runs over the range: a free one costs $0, and runs scale with the range. */
function modelStats(range: string): z.infer<typeof zGetModelStatsResponse> {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const models = [
    { model: "claude-sonnet-5-5", perDay: 3, avgCostUsd: 0.59, avgTokens: 1_550_000 },
    { model: "claude-opus-5-5", perDay: 1.5, avgCostUsd: 1.86, avgTokens: 2_510_000 },
    { model: "claude-haiku-4-5", perDay: 1.4, avgCostUsd: 0.09, avgTokens: 980_000 },
    { model: "claude-sonnet-4-5", perDay: 1.2, avgCostUsd: 0.93, avgTokens: 1_930_000 },
    { model: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017", perDay: 0.8, avgCostUsd: 0, avgTokens: 3_290_000 },
    { model: "claude-opus-4-5", perDay: 0.7, avgCostUsd: 0.71, avgTokens: 1_120_000 },
  ].map(({ model, perDay, avgCostUsd, avgTokens }) => {
    const runs = Math.max(1, Math.round(perDay * days));
    return { model, runs, avgCostUsd, avgTokens, totalCostUsd: avgCostUsd * runs, totalTokens: avgTokens * runs };
  });
  return { since: new Date(Math.floor(Date.now() / DAY) * DAY - (days - 1) * DAY).toISOString(), models };
}
