/**
 * Pure pacing rules for GET /notifications (DESIGN.md "Notification polling rules").
 * GitHub: "There is an X-Poll-Interval header that specifies how often (in seconds) you are
 * allowed to poll. In times of high server load, the time may increase. Please obey the header."
 */

export const MIN_INTERVAL_SEC = 60;
export const MAX_BACKOFF_SEC = 15 * 60;

export interface PollState {
  /** Sent back as If-Modified-Since. */
  readonly lastModified: string | null;
  /** Last X-Poll-Interval seen, never below MIN_INTERVAL_SEC. */
  readonly intervalSec: number;
  /** Earliest moment the next request is allowed. */
  readonly notBefore: Date;
  readonly consecutiveErrors: number;
}

/** Pacing-relevant response headers, already parsed. */
export interface PollHeaders {
  readonly pollIntervalSec?: number;
  readonly lastModified?: string;
  readonly retryAfterSec?: number;
  readonly rateLimitRemaining?: number;
  /** Epoch seconds. */
  readonly rateLimitResetEpochSec?: number;
}

export type PollOutcome =
  | { readonly kind: "not-modified"; readonly headers: PollHeaders }
  | { readonly kind: "modified"; readonly headers: PollHeaders }
  | { readonly kind: "error"; readonly headers: PollHeaders };

export function initialPollState(now: Date): PollState {
  return { lastModified: null, intervalSec: MIN_INTERVAL_SEC, notBefore: now, consecutiveErrors: 0 };
}

/** The state after one request. Every outcome, including errors, honours the latest interval. */
export function nextPollState(previous: PollState, outcome: PollOutcome, now: Date): PollState {
  const intervalSec = Math.max(MIN_INTERVAL_SEC, outcome.headers.pollIntervalSec ?? previous.intervalSec);
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  switch (outcome.kind) {
    case "not-modified":
    case "modified":
      return {
        lastModified: outcome.headers.lastModified ?? previous.lastModified,
        intervalSec,
        notBefore: at(intervalSec),
        consecutiveErrors: 0,
      };
    case "error": {
      const consecutiveErrors = previous.consecutiveErrors + 1;
      const backoffSec = Math.min(MAX_BACKOFF_SEC, MIN_INTERVAL_SEC * 2 ** (consecutiveErrors - 1));
      const { retryAfterSec, rateLimitRemaining, rateLimitResetEpochSec } = outcome.headers;
      const untilResetSec =
        rateLimitRemaining === 0 && rateLimitResetEpochSec !== undefined
          ? Math.max(0, rateLimitResetEpochSec - Math.floor(now.getTime() / 1000))
          : 0;
      const waitSec = Math.max(intervalSec, backoffSec, retryAfterSec ?? 0, untilResetSec);
      return { lastModified: previous.lastModified, intervalSec, notBefore: at(waitSec), consecutiveErrors };
    }
  }
}

/** Parses the pacing headers out of a raw header map; malformed values are ignored. */
export function parsePollHeaders(headers: Readonly<Record<string, string | number | undefined>>): PollHeaders {
  const integer = (name: string): number | undefined => {
    const raw = headers[name];
    const value = typeof raw === "number" ? raw : raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const parsed: { -readonly [K in keyof PollHeaders]: PollHeaders[K] } = {};
  const pollIntervalSec = integer("x-poll-interval");
  if (pollIntervalSec !== undefined) parsed.pollIntervalSec = pollIntervalSec;
  const lastModified = headers["last-modified"];
  if (typeof lastModified === "string" && lastModified.length > 0) parsed.lastModified = lastModified;
  const retryAfterSec = integer("retry-after");
  if (retryAfterSec !== undefined) parsed.retryAfterSec = retryAfterSec;
  const rateLimitRemaining = integer("x-ratelimit-remaining");
  if (rateLimitRemaining !== undefined) parsed.rateLimitRemaining = rateLimitRemaining;
  const rateLimitResetEpochSec = integer("x-ratelimit-reset");
  if (rateLimitResetEpochSec !== undefined) parsed.rateLimitResetEpochSec = rateLimitResetEpochSec;
  return parsed;
}
