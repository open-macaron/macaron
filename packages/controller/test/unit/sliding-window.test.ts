import { describe, expect, it } from "vitest";
import { SlidingWindow } from "../../src/common/sliding-window.ts";
import { FakeClock } from "../support/fakes.ts";

describe("SlidingWindow", () => {
  it("is full once the limit is reached, until the oldest event leaves the period", () => {
    const clock = new FakeClock();
    const window = new SlidingWindow(clock, 2, 60_000);

    window.record();
    clock.advance(30_000);
    window.record();
    expect(window.full()).toBe(true);

    clock.advance(29_999);
    expect(window.full()).toBe(true);
    clock.advance(1);
    expect(window.full()).toBe(false);
  });
});
