import { fileURLToPath } from "node:url";
import { type ConfigSnapshot, loadConfigTree, type RepoConfig } from "@open-macaron/contracts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BotIdentity } from "../../src/github/bot-identity.ts";
import { createGitHub } from "../../src/github/github.ts";
import { ForkUnavailable } from "../../src/publish/fork-registry.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { forkRegistry, MemoryForkStore } from "../support/forks.ts";

const API = "https://api.github.com";
const UPSTREAM = "axel7083/foobar-tmp-demo";
const UPSTREAM_ID = 10;
const BOT_ID = 7;
const server = setupServer();
const env = testEnv();
const gh = createGitHub("test", "token", env.GITHUB_API_VERSION, { throttled: false });

class FixedIdentity extends BotIdentity {
  override get identity() {
    return { login: "macaron-bot", id: BOT_ID, email: "7+macaron-bot@users.noreply.github.com" };
  }
}
const bot = new FixedIdentity(gh, gh, gh, env);

let snapshot: ConfigSnapshot;
let config: RepoConfig;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: "error" });
  snapshot = await loadConfigTree(fileURLToPath(new URL("../../../contracts/test/fixtures/config", import.meta.url)));
  const found = snapshot.repos.get(UPSTREAM);
  if (found === undefined) throw new Error(`${UPSTREAM} missing from the fixtures`);
  config = found;
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

/** A repository as GitHub's API answers it. */
function repository(id: number, owner: { login: string; id: number }, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    full_name: `${owner.login}/${name}`,
    html_url: `https://github.com/${owner.login}/${name}`,
    private: false,
    fork: false,
    owner,
    ...extra,
  };
}

const upstream = (extra: Record<string, unknown> = {}) => repository(UPSTREAM_ID, { login: "axel7083", id: 1 }, "foobar-tmp-demo", extra);
const botFork = (name: string, extra: Record<string, unknown> = {}) =>
  repository(99, { login: "macaron-bot", id: BOT_ID }, name, { fork: true, source: { id: UPSTREAM_ID }, has_wiki: false, has_issues: false, has_projects: false, ...extra });

/** GitHub with `fork` as what forking answers; records every write. */
function github(options: { readonly fork?: (requested: string) => object; readonly actions?: boolean; readonly secured?: boolean; readonly byId?: object }) {
  const writes: string[] = [];
  let requested = "";
  server.use(
    http.get(`${API}/repos/${UPSTREAM}`, () => HttpResponse.json(upstream())),
    http.post(`${API}/repos/${UPSTREAM}/forks`, async ({ request }) => {
      const body = forkRequest(await request.json());
      requested = body.name;
      writes.push(`fork ${body.name} default_branch_only=${String(body.default_branch_only)}`);
      return HttpResponse.json(options.fork?.(body.name) ?? botFork(body.name, { has_wiki: true, has_issues: true, has_projects: true }), { status: 202 });
    }),
    http.get(`${API}/repositories/:id`, () => (options.byId === undefined ? HttpResponse.json({ message: "Not Found" }, { status: 404 }) : HttpResponse.json(options.byId))),
    http.patch(`${API}/repos/macaron-bot/:name`, ({ params }) => {
      if (options.secured === false) return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      writes.push(`settings ${String(params["name"])}`);
      return HttpResponse.json({});
    }),
    http.get(`${API}/repos/macaron-bot/:name/actions/permissions`, () => HttpResponse.json({ enabled: options.actions ?? true, allowed_actions: "all" })),
    http.put(`${API}/repos/macaron-bot/:name/actions/permissions`, async ({ params, request }) => {
      writes.push(`actions ${String(params["name"])} ${JSON.stringify(await request.json())}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { writes, requested: () => requested };
}

function forkRequest(body: unknown): { name: string; default_branch_only: boolean } {
  if (typeof body !== "object" || body === null || !("name" in body) || typeof body.name !== "string") throw new Error("no name");
  return { name: body.name, default_branch_only: "default_branch_only" in body && body.default_branch_only === true };
}

const registry = (store = new MemoryForkStore()) => ({ store, forks: forkRegistry({ gh, bot, env, clock: new FakeClock(), store }) });

describe("ForkRegistry.ensure", () => {
  it("forks a new upstream under a random name, switches everything off, then records it ready", async () => {
    const api = github({});
    const { store, forks } = registry();

    expect(await forks.of(UPSTREAM)).toBeUndefined();
    const ensured = await forks.ensure(config);

    const name = api.requested();
    expect(name).toMatch(/^[a-z0-9]{6}-foobar-tmp-demo$/);
    expect(api.writes).toEqual([`fork ${name} default_branch_only=true`, `settings ${name}`, `actions ${name} {"enabled":false}`]);
    expect(ensured).toEqual({ fork: { owner: "macaron-bot", repo: name }, url: `https://github.com/macaron-bot/${name}`, firstReady: true });
    expect(await forks.of(UPSTREAM)).toEqual({ owner: "macaron-bot", repo: name });
    expect(store.rows.get(UPSTREAM_ID)?.forkId).toBe(99);
  });

  it("adopts the bot's existing fork of the network, under its own name, writing only what differs", async () => {
    // GitHub allows one fork per network: forking answers the one the bot has, e.g. made by hand.
    const api = github({ fork: () => botFork("2elnuw-podman-desktop", { source: { id: UPSTREAM_ID } }), actions: false });
    const { forks } = registry();

    const ensured = await forks.ensure(config);

    expect(ensured.fork).toEqual({ owner: "macaron-bot", repo: "2elnuw-podman-desktop" });
    expect(api.writes).toEqual([`fork ${api.requested()} default_branch_only=true`]);
  });

  it("refuses a repository that isn't the bot's fork of this network, and never marks it ready", async () => {
    github({ fork: (name) => botFork(name, { source: { id: 4242 } }) });
    const { forks } = registry();

    await expect(forks.ensure(config)).rejects.toBeInstanceOf(ForkUnavailable);
    expect(await forks.of(UPSTREAM)).toBeUndefined();
  });

  it("refuses a fork owned by someone else", async () => {
    github({ fork: (name) => repository(99, { login: "someone", id: 8 }, name, { fork: true, source: { id: UPSTREAM_ID } }) });

    await expect(registry().forks.ensure(config)).rejects.toBeInstanceOf(ForkUnavailable);
  });

  it("checks a recorded fork by id, switches Actions off again, and forks nothing", async () => {
    const api = github({ byId: botFork("abc123-foobar-tmp-demo"), actions: true });
    const { forks } = registry(new MemoryForkStore().ready(UPSTREAM, "abc123-foobar-tmp-demo", UPSTREAM_ID));

    const ensured = await forks.ensure(config);

    expect(ensured.firstReady).toBe(false);
    expect(api.writes).toEqual([`actions abc123-foobar-tmp-demo {"enabled":false}`]);
  });

  it("forks again when the recorded fork was deleted", async () => {
    const api = github({});
    const { forks } = registry(new MemoryForkStore().ready(UPSTREAM, "abc123-foobar-tmp-demo", UPSTREAM_ID));

    const ensured = await forks.ensure(config);

    expect(ensured.fork.repo).toBe(api.requested());
    expect(await forks.of(UPSTREAM)).toEqual({ owner: "macaron-bot", repo: api.requested() });
  });

  it("leaves a fork GitHub is still creating not ready, for the job to retry", async () => {
    github({ secured: false });
    const { store, forks } = registry();

    const failure = await forks.ensure(config).catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(ForkUnavailable);
    expect(store.rows.get(UPSTREAM_ID)?.readyAt).toBeNull();
    expect(await forks.of(UPSTREAM)).toBeUndefined();
  });

  it("refuses an upstream that is private or missing", async () => {
    server.use(http.get(`${API}/repos/${UPSTREAM}`, () => HttpResponse.json(upstream({ private: true }))));
    await expect(registry().forks.ensure(config)).rejects.toThrow(/isn't public/);

    server.use(http.get(`${API}/repos/${UPSTREAM}`, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })));
    await expect(registry().forks.ensure(config)).rejects.toBeInstanceOf(ForkUnavailable);
  });
});
