import { Injectable } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";

/** Reads the signal at call time (a plain property read would be narrowed away by control flow). */
export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Time source. Injected everywhere time matters so tests can drive it. */
export abstract class Clock {
  abstract now(): Date;
  /** Resolves after `ms`, or rejects with an AbortError when `signal` aborts. */
  abstract sleep(ms: number, signal: AbortSignal): Promise<void>;
}

@Injectable()
export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }

  override async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await delay(Math.max(0, ms), undefined, { signal });
  }
}
