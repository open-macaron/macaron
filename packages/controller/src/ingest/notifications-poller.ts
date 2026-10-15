import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Clock, isAborted } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { LeaderLock, LockKey } from "../db/leader-lock.ts";
import { NotificationsApi, type NotificationThread } from "./notifications-source.ts";
import { initialPollState, nextPollState, type PollOutcome } from "./poll-policy.ts";
import { PollStateStore } from "./poll-state.store.ts";

/** Receives every notification thread the poller sees. Must be idempotent: a thread can come twice. */
export abstract class NotificationSink {
  abstract accept(thread: NotificationThread): Promise<void>;
}

/**
 * Drives GET /notifications under X-Poll-Interval. Guarantees, in order of importance:
 * 1. no request before the persisted `notBefore` (restarts and crashes included);
 * 2. a single poller across instances (advisory lock);
 * 3. `notBefore` is saved before the loop sleeps again, whatever happened in between.
 */
@Injectable()
export class NotificationsPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsPoller.name);
  private readonly stop = new AbortController();
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly source: NotificationsApi,
    private readonly store: PollStateStore,
    private readonly lock: LeaderLock,
    private readonly sink: NotificationSink,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.MACARON_ENABLED) {
      this.logger.warn("MACARON_ENABLED=false: notifications are not polled");
      return;
    }
    this.loop = this.run(this.stop.signal);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.loop;
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.tick(signal);
      } catch (error: unknown) {
        if (isAborted(signal)) return;
        // tick() already persisted pacing; this only guards against tight loops on unexpected failures.
        this.logger.error(`poll tick failed: ${describeError(error)}`);
        await this.clock.sleep(60_000, signal).catch(() => undefined);
      }
    }
  }

  /** One paced poll. Returns the threads handed to the sink (empty when not leader or nothing new). */
  async tick(signal: AbortSignal): Promise<readonly NotificationThread[]> {
    const state = (await this.store.load()) ?? initialPollState(this.clock.now());
    await this.clock.sleep(state.notBefore.getTime() - this.clock.now().getTime(), signal);

    if (!(await this.lock.holds(LockKey.notificationsPoller))) {
      // Another instance polls. Check again one interval later, without touching the shared state.
      await this.clock.sleep(state.intervalSec * 1000, signal);
      return [];
    }
    // Re-read under the lock: the previous leader may have polled while we were sleeping.
    const current = (await this.store.load()) ?? state;
    if (current.notBefore.getTime() > this.clock.now().getTime()) return [];

    const result = await this.source.fetch(current.lastModified).catch(
      (error: unknown): { outcome: PollOutcome; threads: readonly NotificationThread[] } => {
        this.logger.error(`GET /notifications failed: ${describeError(error)}`);
        return { outcome: { kind: "error", headers: {} }, threads: [] };
      },
    );
    let next = nextPollState(current, result.outcome, this.clock.now());
    try {
      for (const thread of result.threads) {
        await this.sink.accept(thread);
        await this.source.markRead(thread.id);
      }
      return result.threads;
    } catch (error: unknown) {
      // Keep the previous Last-Modified so the unprocessed threads come back on the next poll.
      next = { ...next, lastModified: current.lastModified };
      throw error;
    } finally {
      await this.store.save(next);
      if (result.outcome.kind === "error") {
        this.logger.warn(`poll failed (${String(next.consecutiveErrors)} in a row), next at ${next.notBefore.toISOString()}`);
      }
    }
  }
}
