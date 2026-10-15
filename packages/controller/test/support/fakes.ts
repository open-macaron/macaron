import { Clock } from "../../src/common/clock.ts";
import { PollScheduler } from "../../src/ingest/notifications-poller.ts";
import type { PollState } from "../../src/ingest/poll-policy.ts";
import { PollStateStore } from "../../src/ingest/poll-state.store.ts";

/** A clock that never waits: sleeping advances time instantly and is recorded. */
export class FakeClock extends Clock {
  readonly sleeps: number[] = [];

  constructor(private current: Date = new Date("2026-10-15T12:00:00Z")) {
    super();
  }

  override now(): Date {
    return new Date(this.current);
  }

  override sleep(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.sleeps.push(Math.max(0, ms));
    this.advance(Math.max(0, ms));
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class InMemoryPollStateStore extends PollStateStore {
  readonly saves: PollState[] = [];

  constructor(private state?: PollState) {
    super();
  }

  override load(): Promise<PollState | undefined> {
    return Promise.resolve(this.state);
  }

  override save(state: PollState): Promise<void> {
    this.state = state;
    this.saves.push(state);
    return Promise.resolve();
  }
}

export class RecordingPollScheduler extends PollScheduler {
  readonly scheduled: Date[] = [];

  override start(_tick: () => Promise<void>): Promise<void> {
    return Promise.resolve();
  }

  override at(when: Date): Promise<void> {
    this.scheduled.push(when);
    return Promise.resolve();
  }
}
