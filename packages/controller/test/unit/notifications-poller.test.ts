import { describe, expect, it } from "vitest";
import { NotificationSink, NotificationsPoller } from "../../src/ingest/notifications-poller.ts";
import { NotificationsApi, type NotificationThread, type PollResult } from "../../src/ingest/notifications-source.ts";
import type { PollState } from "../../src/ingest/poll-policy.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock, InMemoryPollStateStore, RecordingPollScheduler } from "../support/fakes.ts";

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

function setup(results: PollResult[], options: { state?: PollState; sink?: RecordingSink } = {}) {
  const clock = new FakeClock();
  const source = new ScriptedSource(clock, results);
  const store = new InMemoryPollStateStore(options.state);
  const sink = options.sink ?? new RecordingSink();
  const scheduler = new RecordingPollScheduler();
  const poller = new NotificationsPoller(testEnv(), source, store, sink, scheduler, clock);
  return { clock, source, store, sink, scheduler, poller };
}

const secondsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;

describe("NotificationsPoller", () => {
  it("schedules the next poll exactly at X-Poll-Interval, and obeys it when GitHub raises it", async () => {
    const { clock, source, scheduler, poller } = setup([
      { outcome: { kind: "modified", headers: { pollIntervalSec: 60, lastModified: "LM1" } }, threads: [] },
      { outcome: { kind: "not-modified", headers: { pollIntervalSec: 300 } }, threads: [] },
      { outcome: { kind: "not-modified", headers: { pollIntervalSec: 300 } }, threads: [] },
    ]);

    for (let poll = 0; poll < 3; poll++) {
      await poller.tick();
      const next = scheduler.scheduled.at(-1);
      if (next === undefined) throw new Error("nothing scheduled");
      clock.advance(next.getTime() - clock.now().getTime());
    }

    const gaps = source.requests.slice(1).map((request, index) => secondsBetween(source.requests[index]?.at ?? request.at, request.at));
    expect(gaps).toEqual([60, 300]);
    expect(source.requests.map((request) => request.lastModified)).toEqual([null, "LM1", "LM1"]);
  });

  it("makes no request when woken before notBefore (cron safety net, restarts), and reschedules instead", async () => {
    const clock = new FakeClock();
    const notBefore = new Date(clock.now().getTime() + 90_000);
    const { source, scheduler, poller } = setup([], { state: { lastModified: "LM0", intervalSec: 120, notBefore, consecutiveErrors: 0 } });

    await expect(poller.tick()).resolves.toEqual([]);

    expect(source.requests).toHaveLength(0);
    expect(scheduler.scheduled).toEqual([notBefore]);
  });

  it("hands every thread to the sink, then marks it read", async () => {
    const { source, sink, poller } = setup([
      { outcome: { kind: "modified", headers: { lastModified: "LM1" } }, threads: [thread("1"), thread("2")] },
    ]);

    await poller.tick();

    expect(sink.accepted).toEqual(["1", "2"]);
    expect(source.read).toEqual(["1", "2"]);
  });

  it("persists pacing and schedules the next poll even when processing fails, keeping the old Last-Modified", async () => {
    const sink = new RecordingSink("2");
    const { store, scheduler, poller } = setup(
      [{ outcome: { kind: "modified", headers: { pollIntervalSec: 60, lastModified: "LM-new" } }, threads: [thread("1"), thread("2")] }],
      { sink, state: { lastModified: "LM-old", intervalSec: 60, notBefore: new Date(0), consecutiveErrors: 0 } },
    );

    await expect(poller.tick()).rejects.toThrow("sink down");

    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]?.lastModified).toBe("LM-old");
    expect(scheduler.scheduled).toHaveLength(1);
  });

  it("backs off on errors: Retry-After decides the next poll", async () => {
    const { clock, store, scheduler, poller } = setup([{ outcome: { kind: "error", headers: { retryAfterSec: 600 } }, threads: [] }]);
    const start = clock.now();

    await poller.tick();

    expect(store.saves[0]?.consecutiveErrors).toBe(1);
    expect(secondsBetween(start, scheduler.scheduled[0] ?? start)).toBe(600);
  });
});
