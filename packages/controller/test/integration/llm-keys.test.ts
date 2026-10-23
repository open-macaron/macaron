import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Capability, Ticket } from "@open-macaron/contracts";
import { eq, sql } from "drizzle-orm";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../../src/accounts/sessions.service.ts";
import { FieldRefused, FreshSessionRequired, KeyStorageUnavailable, TooManyAttempts } from "../../src/common/errors.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { llmEndpoints, llmKeyEvents, llmKeys, users } from "../../src/db/schema.ts";
import type { ProbeResult } from "../../src/keys/key-check.ts";
import { KeyRing, keyAad, SealBroken } from "../../src/keys/key-ring.ts";
import { KeyRotation } from "../../src/keys/key-rotation.ts";
import { LlmKeysService } from "../../src/keys/llm-keys.service.ts";
import { RunsRepository } from "../../src/runs/runs.repository.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext } from "../support/fixtures.ts";
import { startPostgres } from "../support/postgres.ts";

const GOOD = "sk-ant-good-key-0000000000001234";
const OTHER = "sk-ant-good-key-0000000000005678";
const v1 = KeyRing.of(new Map([[1, Buffer.alloc(32, 1)]]));
const v1v2 = KeyRing.of(new Map([[1, Buffer.alloc(32, 1)], [2, Buffer.alloc(32, 2)]]));

/** The endpoints, as far as these tests need them: the key decides the answer. */
const probe = (_baseUrl: string, key: string): Promise<ProbeResult> => {
  if (key.startsWith("sk-ant-good")) return Promise.resolve({ outcome: "accepted", models: ["claude-sonnet-5-5", "claude-haiku-4-5"] });
  if (key.startsWith("sk-ant-down")) return Promise.resolve({ outcome: "unreachable", reason: "no answer within 10 seconds" });
  return Promise.resolve({ outcome: "rejected", status: 401 });
};
const resolve = (host: string): Promise<readonly string[]> => Promise.resolve(host === "llm.internal.example" ? ["10.0.0.7"] : ["93.184.215.14"]);
const models = (): readonly string[] => ["claude-sonnet-5-5", "claude-opus-5-5"];

let container: StartedPostgreSqlContainer;
let db: Db;
/** One clock for the file, only ever moved forward: the history is ordered by it. */
const clock = new FakeClock(new Date());
/** Every line the controller logs during these tests: none may hold a key. */
const logged: string[] = [];
for (const level of ["log", "warn", "error", "debug"] satisfies (keyof Logger)[]) {
  vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
    logged.push(String(message));
  });
}

let endpointId = "";
let privateEndpointId = "";
let disabledEndpointId = "";

/** The service, a second later than the last call: each event gets its own time. */
function keys(ring: KeyRing = v1): LlmKeysService {
  clock.advance(1000);
  return new LlmKeysService(db, ring, probe, resolve, models, clock);
}

/** A deployment without LLM_KEK_DIR. */
function withoutStorage(): LlmKeysService {
  return new LlmKeysService(db, undefined, probe, resolve, models, clock);
}

function signedIn(id: string, minutesAgo = 1): SessionUser {
  return { id, githubId: id === "user-a" ? 11 : 12, githubLogin: id === "user-a" ? "alice" : "bob", name: id, image: null, role: "user", signedInAt: new Date(clock.now().getTime() - minutesAgo * 60_000) };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await db.insert(users).values([
    { id: "user-a", name: "Alice", email: "alice@example.test", githubId: 11, githubLogin: "alice", capabilities: Capability.options },
    { id: "user-b", name: "Bob", email: "bob@example.test", githubId: 12, githubLogin: "bob", capabilities: ["review"] },
  ]);
  const inserted = await db
    .insert(llmEndpoints)
    .values([
      { name: "Anthropic API", baseUrl: "https://api.anthropic.example" },
      { name: "Moved inside", baseUrl: "https://llm.internal.example" },
      { name: "Retired", baseUrl: "https://retired.example", enabled: false },
    ])
    .returning({ id: llmEndpoints.id, name: llmEndpoints.name });
  const idOf = (name: string): string => inserted.find((row) => row.name === name)?.id ?? "";
  endpointId = idOf("Anthropic API");
  privateEndpointId = idOf("Moved inside");
  disabledEndpointId = idOf("Retired");
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

describe("LlmKeysService", () => {
  it("refuses to store anything without a key ring", async () => {
    expect(await rejection(withoutStorage().save(signedIn("user-a"), { endpointId, key: GOOD }))).toBeInstanceOf(KeyStorageUnavailable);
    expect((await withoutStorage().mine(signedIn("user-a"))).storage).toBe(false);
  });

  it("needs a sign-in younger than 10 minutes to save or delete", async () => {
    expect(await rejection(keys().save(signedIn("user-a", 11), { endpointId, key: GOOD }))).toBeInstanceOf(FreshSessionRequired);
    expect(await rejection(keys().remove(signedIn("user-a", 11)))).toBeInstanceOf(FreshSessionRequired);
  });

  it("refuses a disabled endpoint, and one whose host now resolves to a private address", async () => {
    const disabled = await rejection(keys().save(signedIn("user-a"), { endpointId: disabledEndpointId, key: GOOD }));
    expect(disabled).toBeInstanceOf(FieldRefused);
    const moved = await rejection(keys().save(signedIn("user-a"), { endpointId: privateEndpointId, key: GOOD }));
    expect(moved).toMatchObject({ field: "endpointId" });
    expect(String(moved)).toMatch(/private or reserved/);
  });

  it("records a key the endpoint refuses or can't check, and stores nothing", async () => {
    const refused = await rejection(keys().save(signedIn("user-a"), { endpointId, key: "sk-ant-wrong-000000000000abcd" }));
    expect(refused).toMatchObject({ field: "key" });
    expect(String(refused)).toMatch(/refused this key \(HTTP 401\)/);
    expect(String(await rejection(keys().save(signedIn("user-a"), { endpointId, key: "sk-ant-down-0000000000000000" })))).toMatch(/no answer within 10 seconds/);
    expect(await db.select().from(llmKeys).where(eq(llmKeys.userId, "user-a"))).toEqual([]);
    const history = await keys().events("user-a", 10, undefined);
    expect(history.events.map((event) => [event.kind, event.last4, event.detail])).toEqual([
      ["unreachable", "0000", "no answer within 10 seconds"],
      ["rejected", "abcd", "HTTP 401"],
    ]);
  });

  it("seals an accepted key, shows only its last 4 characters, and names the models the endpoint lacks", async () => {
    const saved = await keys().save(signedIn("user-a"), { endpointId, key: GOOD });
    expect(saved.key).toMatchObject({ last4: "1234", status: "valid", endpoint: { id: endpointId, name: "Anthropic API", enabled: true } });
    expect(saved.missingModels).toEqual(["claude-opus-5-5"]);
    expect(JSON.stringify(await keys().mine(signedIn("user-a")))).not.toContain(GOOD);

    // Nothing in the database holds the key: a full dump, as the backups take it.
    const dump = await container.exec(["pg_dump", "--username", "macaron", "--data-only", "macaron"]);
    expect(dump.exitCode).toBe(0);
    expect(dump.output).toContain("llm_keys");
    expect(dump.output).not.toContain(GOOD.slice(0, 20));

    const [row] = await db.select().from(llmKeys).where(eq(llmKeys.userId, "user-a"));
    if (row === undefined) throw new Error("no row");
    expect(row.kekVersion).toBe(1);
    expect(v1.open(row, keyAad("user-a", endpointId))).toBe(GOOD);
    // A row copied to another user doesn't open.
    expect(() => v1.open(row, keyAad("user-b", endpointId))).toThrow(SealBroken);
  });

  it("replaces a key, saying which one it replaced", async () => {
    const saved = await keys().save(signedIn("user-a"), { endpointId, key: OTHER });
    expect(saved.key.last4).toBe("5678");
    const [latest] = (await keys().events("user-a", 1, undefined)).events;
    expect(latest).toMatchObject({ kind: "replaced", last4: "5678", detail: "replaces the key ending in 1234", endpointName: "Anthropic API" });
  });

  it("allows 5 attempts per hour, whatever their outcome", async () => {
    // user-a has made 4 attempts above (2 refused, 2 saved).
    await keys().save(signedIn("user-a"), { endpointId, key: GOOD });
    expect(await rejection(keys().save(signedIn("user-a"), { endpointId, key: GOOD }))).toBeInstanceOf(TooManyAttempts);
    // One save at a time per user: a concurrent one is refused before it reaches the endpoint.
    const service = keys();
    const concurrent = await Promise.allSettled([1, 2, 3].map(() => service.save(signedIn("user-b"), { endpointId, key: "sk-ant-wrong-0000000000000000" })));
    const reasons = concurrent.map((result): unknown => (result.status === "rejected" ? result.reason : undefined));
    expect(reasons.filter((reason) => reason instanceof TooManyAttempts)).toHaveLength(2);
    expect(reasons.filter((reason) => reason instanceof FieldRefused)).toHaveLength(1);
    clock.advance(61 * 60_000);
    expect((await keys().save(signedIn("user-a"), { endpointId, key: OTHER })).key.last4).toBe("5678");
  });

  it("pages the history, newest first", async () => {
    const first = await keys().events("user-a", 4, undefined);
    expect(first.events).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const second = await keys().events("user-a", 4, first.nextCursor ?? undefined);
    expect(second.events.map((event) => event.kind)).toEqual(["unreachable", "rejected"]);
    expect(second.nextCursor).toBeNull();
  });

  it("deletes a key, keeping its history; deleting none is a no-op", async () => {
    await keys().remove(signedIn("user-a"));
    expect((await keys().mine(signedIn("user-a"))).key).toBeNull();
    expect((await keys().events("user-a", 1, undefined)).events[0]).toMatchObject({ kind: "deleted", last4: "5678" });
    await keys().remove(signedIn("user-a"));
    expect((await keys().events("user-a", 1, undefined)).events[0]?.kind).toBe("deleted");
  });

  it("keeps the history append-only; it goes only with its user", async () => {
    await expect(db.update(llmKeyEvents).set({ detail: "rewritten" })).rejects.toThrow();
    await expect(db.delete(llmKeyEvents).where(eq(llmKeyEvents.userId, "user-a"))).rejects.toThrow();
    await expect(db.execute(sql`TRUNCATE llm_key_events`)).rejects.toThrow();
    await db.insert(users).values({ id: "user-gone", name: "Gone", email: "gone@example.test", githubId: 99, githubLogin: "gone" });
    await db.insert(llmKeyEvents).values({ userId: "user-gone", kind: "deleted" });
    await db.delete(users).where(eq(users.id, "user-gone"));
    expect(await db.select().from(llmKeyEvents).where(eq(llmKeyEvents.userId, "user-gone"))).toEqual([]);
  });
});

describe("LlmKeysService at a run's start", () => {
  const SETTINGS = "https://macaron.example.test/settings/key";

  it("refuses an account without a key, pointing at the key page", async () => {
    expect(await keys().upstreamFor("user-b", SETTINGS)).toEqual({ refusal: expect.stringContaining(`there's none saved for this account: save one on macaron (${SETTINGS})`) });
  });

  it("gives the payer's endpoint and key, checked with the endpoint first", async () => {
    await keys().save(signedIn("user-b"), { endpointId, key: OTHER });
    const before = clock.now();
    const resolved = await keys().upstreamFor("user-b", SETTINGS);
    expect(resolved).toEqual({ upstream: { endpointId, baseUrl: "https://api.anthropic.example", key: OTHER, last4: "5678" } });
    const [row] = await db.select().from(llmKeys).where(eq(llmKeys.userId, "user-b"));
    expect(row?.validatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("records the run in the key's history, with its thread", async () => {
    const runs = new RunsRepository(db);
    const thread = await runs.thread("org-x/repo-a", 77, "pull");
    const run = await runs.createRun({
      threadId: thread.id,
      ticket: Ticket.parse(`t_${"9".repeat(43)}`),
      mode: "review",
      harness: "claude",
      model: "claude-sonnet-5-5",
      fastModel: "claude-haiku-4-5",
      context: runContext(),
      route: { mode: "review", subject: { kind: "pullRequest", number: 77 }, checkout: { from: "defaultBranch" }, branch: "macaron/77-review" },
      limitMicros: 500_000,
      triggerGithubId: 12,
      payerId: "user-b",
    });
    await keys().recordUse("user-b", run.id, endpointId, "5678");
    const [latest] = (await keys().events("user-b", 1, undefined)).events;
    expect(latest).toMatchObject({ kind: "used", last4: "5678", thread: { repo: "org-x/repo-a", number: 77, kind: "pull" } });
  });

  it("marks a key the endpoint now refuses, and refuses the run", async () => {
    // The endpoint revoked it: the probe answers 401 for it from now on.
    await db.update(llmKeys).set({ last4: "9999" }).where(eq(llmKeys.userId, "user-b"));
    const revoked = new LlmKeysService(db, v1, () => Promise.resolve({ outcome: "rejected", status: 401 }), resolve, models, clock);
    expect(await revoked.upstreamFor("user-b", SETTINGS)).toEqual({ refusal: expect.stringContaining("refused this account's LLM key (HTTP 401)") });
    expect((await keys().mine(signedIn("user-b"))).key?.status).toBe("rejected");
    expect((await keys().events("user-b", 1, undefined)).events[0]).toMatchObject({ kind: "rejected", detail: "HTTP 401 before a run" });
    // Until it's saved again, no run asks the endpoint.
    expect(await keys().upstreamFor("user-b", SETTINGS)).toEqual({ refusal: expect.stringContaining("save it again, or another one") });
  });

  it("refuses without marking when the endpoint can't be reached, and when its endpoint is disabled", async () => {
    await db.update(llmKeys).set({ status: "valid" }).where(eq(llmKeys.userId, "user-b"));
    const down = new LlmKeysService(db, v1, () => Promise.resolve({ outcome: "unreachable", reason: "no answer within 10 seconds" }), resolve, models, clock);
    expect(await down.upstreamFor("user-b", SETTINGS)).toEqual({ refusal: expect.stringContaining("couldn't be reached") });
    expect((await keys().mine(signedIn("user-b"))).key?.status).toBe("valid");
    await db.update(llmEndpoints).set({ enabled: false }).where(eq(llmEndpoints.id, endpointId));
    expect(await keys().upstreamFor("user-b", SETTINGS)).toEqual({ refusal: expect.stringContaining("which an administrator disabled") });
    await db.update(llmEndpoints).set({ enabled: true }).where(eq(llmEndpoints.id, endpointId));
  });

  it("refuses a key it can't read rather than failing the run later", async () => {
    expect(await withoutStorage().upstreamFor("user-b", SETTINGS)).toEqual({ refusal: expect.stringContaining("can't be read on this deployment") });
  });
});

describe("logs", () => {
  it("never hold a key, refused or saved", () => {
    expect(logged.some((line) => line.includes("saved a key"))).toBe(true);
    expect(logged.some((line) => line.includes("not saved: rejected"))).toBe(true);
    for (const line of logged) expect(line).not.toMatch(/sk-ant-(good|wrong|down)-key|sk-ant-(wrong|down)-0/);
  });
});

describe("KeyRotation", () => {
  it("re-seals every key under the newest version, then old versions can be retired", async () => {
    await keys(v1).save(signedIn("user-a"), { endpointId, key: GOOD });
    const report = await new KeyRotation(db, v1v2).rotate();
    // user-a's key, and user-b's saved above.
    expect(report).toEqual({ current: 2, resealed: 2, unreadable: 0 });
    const [row] = await db.select().from(llmKeys).where(eq(llmKeys.userId, "user-a"));
    if (row === undefined) throw new Error("no row");
    expect(row.kekVersion).toBe(2);
    const v2 = KeyRing.of(new Map([[2, Buffer.alloc(32, 2)]]));
    expect(v2.open(row, keyAad("user-a", endpointId))).toBe(GOOD);
    expect(await new KeyRotation(db, v2).rotate()).toEqual({ current: 2, resealed: 0, unreadable: 0 });
  });

  it("counts keys under a version the ring no longer has", async () => {
    const v3 = KeyRing.of(new Map([[3, Buffer.alloc(32, 3)]]));
    expect(await new KeyRotation(db, v3).rotate()).toEqual({ current: 3, resealed: 0, unreadable: 2 });
  });
});
