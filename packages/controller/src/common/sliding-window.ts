import type { Clock } from "./clock.ts";

/** Counts events over the last `periodMs`, to cap how many may happen in any such period. */
export class SlidingWindow {
  private readonly times: number[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly periodMs: number,
  ) {}

  full(): boolean {
    const start = this.clock.now().getTime() - this.periodMs;
    while (this.times[0] !== undefined && this.times[0] <= start) this.times.shift();
    return this.times.length >= this.limit;
  }

  record(): void {
    this.times.push(this.clock.now().getTime());
  }
}
