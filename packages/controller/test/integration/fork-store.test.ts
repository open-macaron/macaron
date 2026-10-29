import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { DrizzleForkStore } from "../../src/publish/fork-registry.ts";
import { startPostgres } from "../support/postgres.ts";

let container: StartedPostgreSqlContainer;
let db: Db;
let store: DrizzleForkStore;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  store = new DrizzleForkStore(db);
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

describe("DrizzleForkStore", () => {
  it("serves a fork only once it is ready, and marks it ready once", async () => {
    await store.record({ upstreamId: 1, upstreamKey: "org-x/repo-a", forkId: 101, forkName: "abc123-repo-a" });
    expect(await store.readyName("org-x/repo-a")).toBeUndefined();

    expect(await store.markReady(1)).toBe(true);
    expect(await store.markReady(1)).toBe(false);
    expect(await store.readyName("org-x/repo-a")).toBe("abc123-repo-a");
  });

  it("keeps readiness when the fork is recorded again", async () => {
    await store.record({ upstreamId: 1, upstreamKey: "org-x/repo-a", forkId: 101, forkName: "abc123-repo-a" });

    expect((await store.byUpstream(1))?.readyAt).not.toBeNull();
  });

  it("lets two upstreams of one network share a fork", async () => {
    await store.record({ upstreamId: 2, upstreamKey: "someone/repo-a", forkId: 101, forkName: "abc123-repo-a" });
    await store.markReady(2);

    expect(await store.readyName("someone/repo-a")).toBe("abc123-repo-a");
    expect(await store.readyName("org-x/repo-a")).toBe("abc123-repo-a");
  });

  it("follows a rename: the configured name moves to the repository that now holds it", async () => {
    // org-x/repo-a was renamed, and a new repository took its old name.
    await store.record({ upstreamId: 3, upstreamKey: "org-x/repo-a", forkId: 303, forkName: "xyz789-repo-a" });

    expect((await store.byUpstream(1))).toBeUndefined();
    expect(await store.readyName("org-x/repo-a")).toBeUndefined();
  });
});
