import { describe, expect, it } from "vitest";
import {
  initialPollState,
  MAX_BACKOFF_SEC,
  nextPollState,
  parsePollHeaders,
  type PollState,
} from "../../src/ingest/poll-policy.ts";

const now = new Date("2026-10-15T12:00:00Z");
const secondsAfterNow = (state: PollState) => (state.notBefore.getTime() - now.getTime()) / 1000;

describe("nextPollState", () => {
  it("waits exactly X-Poll-Interval after a 304, and keeps Last-Modified", () => {
    const previous = { ...initialPollState(now), lastModified: "Wed, 14 Oct 2026 10:00:00 GMT" };

    const next = nextPollState(previous, { kind: "not-modified", headers: { pollIntervalSec: 60 } }, now);

    expect(secondsAfterNow(next)).toBe(60);
    expect(next.lastModified).toBe("Wed, 14 Oct 2026 10:00:00 GMT");
  });

  it("obeys an interval raised by GitHub under load, even when it arrives on a 304", () => {
    const next = nextPollState(initialPollState(now), { kind: "not-modified", headers: { pollIntervalSec: 300 } }, now);

    expect(next.intervalSec).toBe(300);
    expect(secondsAfterNow(next)).toBe(300);
  });

  it("keeps the last known interval when the header is missing", () => {
    const previous = { ...initialPollState(now), intervalSec: 180 };

    const next = nextPollState(previous, { kind: "modified", headers: {} }, now);

    expect(secondsAfterNow(next)).toBe(180);
  });

  it("never polls faster than 60 s, whatever the header says", () => {
    const next = nextPollState(initialPollState(now), { kind: "modified", headers: { pollIntervalSec: 5 } }, now);

    expect(secondsAfterNow(next)).toBe(60);
  });

  it("stores the new Last-Modified after a 200", () => {
    const next = nextPollState(
      initialPollState(now),
      { kind: "modified", headers: { pollIntervalSec: 60, lastModified: "Thu, 15 Oct 2026 11:59:00 GMT" } },
      now,
    );

    expect(next.lastModified).toBe("Thu, 15 Oct 2026 11:59:00 GMT");
  });

  it("waits at least Retry-After on 403/429", () => {
    const next = nextPollState(initialPollState(now), { kind: "error", headers: { pollIntervalSec: 60, retryAfterSec: 600 } }, now);

    expect(secondsAfterNow(next)).toBe(600);
  });

  it("waits for the primary rate-limit reset when the budget is exhausted", () => {
    const reset = Math.floor(now.getTime() / 1000) + 1_200;

    const next = nextPollState(
      initialPollState(now),
      { kind: "error", headers: { rateLimitRemaining: 0, rateLimitResetEpochSec: reset } },
      now,
    );

    expect(secondsAfterNow(next)).toBe(1_200);
  });

  it("backs off exponentially on an error burst, never below the interval, capped at 15 min", () => {
    let state = initialPollState(now);
    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      state = nextPollState(state, { kind: "error", headers: {} }, now);
      waits.push(secondsAfterNow(state));
    }

    expect(waits).toEqual([60, 120, 240, 480, MAX_BACKOFF_SEC, MAX_BACKOFF_SEC, MAX_BACKOFF_SEC]);
  });

  it("resets the error count after a success", () => {
    const failing = { ...initialPollState(now), consecutiveErrors: 4 };

    expect(nextPollState(failing, { kind: "not-modified", headers: {} }, now).consecutiveErrors).toBe(0);
  });
});

describe("parsePollHeaders", () => {
  it("reads the pacing headers and ignores malformed values", () => {
    expect(
      parsePollHeaders({
        "x-poll-interval": "120",
        "last-modified": "Thu, 15 Oct 2026 11:59:00 GMT",
        "retry-after": "not-a-number",
        "x-ratelimit-remaining": 0,
        "x-ratelimit-reset": "1792068000",
      }),
    ).toEqual({
      pollIntervalSec: 120,
      lastModified: "Thu, 15 Oct 2026 11:59:00 GMT",
      rateLimitRemaining: 0,
      rateLimitResetEpochSec: 1792068000,
    });
  });
});
