import { describe, expect, it } from "vitest";
import { NotificationSink, NotificationsPoller } from "../../src/ingest/notifications-poller.ts";
import { NotificationsApi, type NotificationThread, type PollResult } from "../../src/ingest/notifications-source.ts";
import type { PollState } from "../../src/ingest/poll-policy.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock, FakeLeaderLock, InMemoryPollStateStore } from "../support/fakes.ts";

const thread = (id: string): NotificationThread => ({
  id,
  reason: "mention",
  repo: "org-x/repo-a",
  subjectType: "Issue",
  subjectUrl: "https://api.github.com/repos/org-x/repo-a/issues/12",
  latestCommentUrl: null,
  title: "Crash on start",
  updatedAt: new Date("2026-10-15T11:59:00Z"),
});

/** Records every request with the time it was made, and replays scripted results. */
class ScriptedSource extends NotificationsApi {
  readonly requests: { at: Date; lastModified: string | null }[] = [];
  readonly read: string[] = [];

  constructor(
    private readonly clock: FakeClock,
    private readonly results: PollResult[],
  ) {
    super();
  }

  override fetch(lastModified: string | null): Promise<PollResult> {
    this.requests.push({ at: this.clock.now(), lastModified });
    const next = this.results.shift();
    if (next === undefined) throw new Error("no scripted result left");
    return Promise.resolve(next);
  }

  override markRead(threadId: string): Promise<void> {
    this.read.push(threadId);
    return Promise.resolve();
  }
}

class RecordingSink extends NotificationSink {
  readonly accepted: string[] = [];

  constructor(private readonly failOn?: string) {
    super();
  }

  override accept(item: NotificationThread): Promise<void> {
    if (item.id === this.failOn) return Promise.reject(new Error("sink down"));
    this.accepted.push(item.id);
    return Promise.resolve();
  }
}

function setup(results: PollResult[], options: { state?: PollState; leader?: boolean; sink?: RecordingSink } = {}) {
  const clock = new FakeClock();
  const source = new ScriptedSource(clock, results);
  const store = new InMemoryPollStateStore(options.state);
  const sink = options.sink ?? new RecordingSink();
  const poller = new NotificationsPoller(
    testEnv(),
    source,
    store,
    new FakeLeaderLock(options.leader ?? true),
    sink,
    clock,
  );
  return { clock, source, store, sink, poller, signal: new AbortController().signal };
}

describe("NotificationsPoller", () => {
  it("never sends two requests closer than X-Poll-Interval, even when GitHub raises it", async () => {
    const { source, poller, signal } = setup([
      { outcome: { kind: "modified", headers: { pollIntervalSec: 60, lastModified: "LM1" } }, threads: [] },
      { outcome: { kind: "not-modified", headers: { pollIntervalSec: 300 } }, threads: [] },
      { outcome: { kind: "not-modified", headers: { pollIntervalSec: 300 } }, threads: [] },
    ]);

    for (let tick = 0; tick < 3; tick++) await poller.tick(signal);

    const gaps = source.requests.slice(1).map((request, index) => {
      const previous = source.requests[index];
      if (previous === undefined) throw new Error("unreachable");
      return (request.at.getTime() - previous.at.getTime()) / 1000;
    });
    expect(gaps).toEqual([60, 300]);
    expect(source.requests.map((request) => request.lastModified)).toEqual([null, "LM1", "LM1"]);
  });

  it("respects a persisted notBefore after a restart", async () => {
    const clock = new FakeClock();
    const state: PollState = {
      lastModified: "LM0",
      intervalSec: 120,
      notBefore: new Date(clock.now().getTime() + 90_000),
      consecutiveErrors: 0,
    };
    const { source, poller, signal, clock: pollerClock } = setup(
      [{ outcome: { kind: "not-modified", headers: {} }, threads: [] }],
      { state },
    );

    await poller.tick(signal);

    expect(pollerClock.sleeps[0]).toBe(90_000);
    expect(source.requests[0]?.at.toISOString()).toBe(state.notBefore.toISOString());
  });

  it("does not poll when another instance holds the lock", async () => {
    const { source, store, poller, signal } = setup([], { leader: false });

    await expect(poller.tick(signal)).resolves.toEqual([]);

    expect(source.requests).toHaveLength(0);
    expect(store.saves).toHaveLength(0);
  });

  it("hands every thread to the sink, then marks it read", async () => {
    const { source, sink, poller, signal } = setup([
      { outcome: { kind: "modified", headers: { lastModified: "LM1" } }, threads: [thread("1"), thread("2")] },
    ]);

    await poller.tick(signal);

    expect(sink.accepted).toEqual(["1", "2"]);
    expect(source.read).toEqual(["1", "2"]);
  });

  it("persists pacing even when processing fails, keeping the old Last-Modified for a replay", async () => {
    const sink = new RecordingSink("2");
    const { store, poller, signal } = setup(
      [{ outcome: { kind: "modified", headers: { pollIntervalSec: 60, lastModified: "LM-new" } }, threads: [thread("1"), thread("2")] }],
      { sink, state: { lastModified: "LM-old", intervalSec: 60, notBefore: new Date(0), consecutiveErrors: 0 } },
    );

    await expect(poller.tick(signal)).rejects.toThrow("sink down");

    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]?.lastModified).toBe("LM-old");
  });

  it("backs off on errors and persists the next allowed time", async () => {
    const { store, poller, signal } = setup([{ outcome: { kind: "error", headers: { retryAfterSec: 600 } }, threads: [] }]);

    await poller.tick(signal);

    expect(store.saves[0]?.consecutiveErrors).toBe(1);
    const waitSec = ((store.saves[0]?.notBefore.getTime() ?? 0) - new Date("2026-10-15T12:00:00Z").getTime()) / 1000;
    expect(waitSec).toBe(600);
  });
});
