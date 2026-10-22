import { join } from "node:path";
import { CommitSha, type PublishedConfig, readConfigFiles } from "@open-macaron/contracts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UpstreamError } from "../../src/common/errors.ts";
import { ConfigSnapshotStore } from "../../src/config/config-snapshots.store.ts";
import { PublishedConfigClient } from "../../src/config/published-config.client.ts";
import { RepoConfigService } from "../../src/config/repo-config.service.ts";
import { testEnv } from "../support/env.ts";

const BASE = "https://config.example.test/v1";
const ONE = CommitSha.parse("1".repeat(40));
const TWO = CommitSha.parse("2".repeat(40));
const repoConfigDir = join(import.meta.dirname, "..", "..", "..", "contracts", "test", "fixtures", "config");
const files = Object.fromEntries(await readConfigFiles(repoConfigDir));

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

const env = () => testEnv({ CONFIG_URL: BASE, CONFIG_REPO_ID: "3003" });
const published = (commit: CommitSha, overrides: Readonly<Record<string, string>> = {}): PublishedConfig => ({
  version: 1,
  commit,
  files: { ...files, ...overrides },
});

class MemoryStore extends ConfigSnapshotStore {
  readonly saved: PublishedConfig[] = [];
  override latest(): Promise<PublishedConfig | undefined> {
    return Promise.resolve(this.saved.at(-1));
  }
  override applied(config: PublishedConfig): Promise<void> {
    this.saved.push(config);
    return Promise.resolve();
  }
}

/** Serves `config` with an ETag; answers 304 to a matching If-None-Match. */
function serve(config: PublishedConfig | (() => PublishedConfig)): { readonly queries: string[] } {
  const queries: string[] = [];
  server.use(
    http.get(`${BASE}/config.json`, ({ request }) => {
      const body = typeof config === "function" ? config() : config;
      queries.push(new URL(request.url).search);
      const etag = `"${body.commit}"`;
      if (request.headers.get("if-none-match") === etag) return new HttpResponse(null, { status: 304 });
      return HttpResponse.json(body, { headers: { etag } });
    }),
  );
  return { queries };
}

describe("PublishedConfigClient", () => {
  it("revalidates with the ETag, and skips the CDN cache for an expected commit", async () => {
    const { queries } = serve(published(ONE));
    const client = new PublishedConfigClient(env());

    expect(await client.fetch()).toMatchObject({ changed: true, config: { commit: ONE } });
    expect(await client.fetch()).toEqual({ changed: false });
    expect(await client.fetch(ONE)).toMatchObject({ changed: true, config: { commit: ONE } });
    expect(queries).toEqual(["", "", `?commit=${ONE}`]);
  });

  it("refuses an older commit than the one a deployment reported, and anything not a snapshot", async () => {
    serve(published(ONE));
    await expect(new PublishedConfigClient(env()).fetch(TWO)).rejects.toThrow(UpstreamError);

    server.use(http.get(`${BASE}/config.json`, () => HttpResponse.json({ version: 1, commit: ONE, files: { "../etc/passwd": "x" } })));
    await expect(new PublishedConfigClient(env()).fetch()).rejects.toThrow(/not a published configuration/);

    server.use(http.get(`${BASE}/config.json`, () => new HttpResponse(null, { status: 503 })));
    await expect(new PublishedConfigClient(env()).fetch()).rejects.toThrow(/answered 503/);
  });
});

describe("RepoConfigService with a published configuration", () => {
  async function started(store = new MemoryStore()): Promise<{ service: RepoConfigService; store: MemoryStore }> {
    const service = new RepoConfigService(env(), new PublishedConfigClient(env()), store);
    await service.onModuleInit();
    service.onApplicationShutdown();
    return { service, store };
  }

  it("boots on the published snapshot and records it", async () => {
    serve(published(ONE));
    const { service, store } = await started();

    expect(service.commit).toBe(ONE);
    expect(service.repo("axel7083/foobar-tmp-demo")?.project).toBe("sandbox");
    expect(store.saved.map((config) => config.commit)).toEqual([ONE]);
  });

  it("boots on the snapshot applied last when Pages is down, and refuses to start without one", async () => {
    server.use(http.get(`${BASE}/config.json`, () => HttpResponse.error()));
    const store = new MemoryStore();
    await store.applied(published(ONE));

    expect((await started(store)).service.commit).toBe(ONE);
    await expect(started(new MemoryStore())).rejects.toThrow(/no configuration to start with/);
  });

  it("applies a valid new commit, and keeps the live one on an invalid or unchecked one", async () => {
    let current = published(ONE);
    serve(() => current);
    const { service, store } = await started();

    current = published(TWO, { "projects/sandbox/repos/broken.yaml": "repo: not a slug\n" });
    expect(await service.reload(TWO)).toMatchObject({ applied: false, retry: false });
    expect(service.commit).toBe(ONE);

    service.addCheck(() => Promise.resolve(["no price for claude-unknown"]));
    current = published(TWO);
    expect(await service.reload(TWO)).toMatchObject({ applied: false, retry: false, reason: expect.stringContaining("no price") });
    expect(service.commit).toBe(ONE);
    expect(store.saved.map((config) => config.commit)).toEqual([ONE]);
  });

  it("retries a commit Pages doesn't serve yet, then applies it", async () => {
    let current = published(ONE);
    serve(() => current);
    const { service, store } = await started();

    expect(await service.reload(TWO)).toMatchObject({ applied: false, retry: true });
    current = published(TWO);
    expect(await service.reload(TWO)).toEqual({ applied: true, commit: TWO });
    expect(await service.reload()).toMatchObject({ applied: false, reason: "unchanged" });
    expect(store.saved.map((config) => config.commit)).toEqual([ONE, TWO]);
  });
});
