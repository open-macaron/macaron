import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { Jobs, NoPayload, Queue } from "../jobs/jobs.ts";
import { NotificationsApi, type NotificationThread, type PollResult } from "./notifications-source.ts";
import { initialPollState, nextPollState } from "./poll-policy.ts";
import { PollStateStore } from "./poll-state.store.ts";

/** Receives every notification thread the poller sees. Must be idempotent: a thread can come twice. */
export abstract class NotificationSink {
  abstract accept(thread: NotificationThread): Promise<void>;
}

/** Runs `tick` as a single-instance job and decides when. Implemented with pg-boss; abstract so the poller is testable alone. */
export abstract class PollScheduler {
  abstract start(tick: () => Promise<void>): Promise<void>;
  abstract at(when: Date): Promise<void>;
}

@Injectable()
export class PgBossPollScheduler extends PollScheduler {
  constructor(private readonly jobs: Jobs) {
    super();
  }

  override async start(tick: () => Promise<void>): Promise<void> {
    await this.jobs.work(Queue.pollNotifications, NoPayload, tick);
    await this.jobs.keepPolling();
  }

  override at(when: Date): Promise<void> {
    return this.jobs.pollAt(when);
  }
}

/**
 * GET /notifications under X-Poll-Interval, as a pg-boss job (one active across instances).
 * Guarantees, in order of importance:
 * 1. no request before the persisted `notBefore`: a tick that wakes early only reschedules;
 * 2. `notBefore` is saved, and the next poll scheduled, whatever happened during the tick.
 */
@Injectable()
export class NotificationsPoller implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsPoller.name);

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly source: NotificationsApi,
    private readonly store: PollStateStore,
    private readonly sink: NotificationSink,
    private readonly scheduler: PollScheduler,
    private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.MACARON_ENABLED) {
      this.logger.warn("MACARON_ENABLED=false: notifications are not polled");
      return;
    }
    await this.scheduler.start(async () => {
      await this.tick();
    });
  }

  /** One paced poll. Returns the threads handed to the sink (empty when it was too early or nothing changed). */
  async tick(): Promise<readonly NotificationThread[]> {
    const state = (await this.store.load()) ?? initialPollState(this.clock.now());
    if (state.notBefore.getTime() > this.clock.now().getTime()) {
      await this.scheduler.at(state.notBefore);
      return [];
    }

    const result = await this.source.fetch(state.lastModified).catch((error: unknown): PollResult => {
      this.logger.error(`GET /notifications failed: ${describeError(error)}`);
      return { outcome: { kind: "error", headers: {} }, threads: [] };
    });
    let next = nextPollState(state, result.outcome, this.clock.now());
    try {
      for (const thread of result.threads) {
        await this.sink.accept(thread);
        await this.source.markRead(thread.id);
      }
      return result.threads;
    } catch (error: unknown) {
      // Keep the previous Last-Modified so the unprocessed threads come back on the next poll.
      next = { ...next, lastModified: state.lastModified };
      throw error;
    } finally {
      await this.store.save(next);
      await this.scheduler.at(next.notBefore);
      if (result.outcome.kind === "error") {
        this.logger.warn(`poll failed (${String(next.consecutiveErrors)} in a row), next at ${next.notBefore.toISOString()}`);
      }
    }
  }
}
