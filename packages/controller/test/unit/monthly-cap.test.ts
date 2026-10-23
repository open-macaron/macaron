import { describe, expect, it } from "vitest";
import { capRefusal, monthStart } from "../../src/accounts/monthly-cap.service.ts";

const SETTINGS = "https://macaron.example.test/settings/key";
const usd = (amount: number): number => Math.round(amount * 1_000_000);

describe("capRefusal", () => {
  it("lets any run through without a cap", () => {
    expect(capRefusal(null, usd(1_000), usd(1_000), usd(5), SETTINGS)).toBeUndefined();
  });

  it("lets a run through while what's billed, reserved and its limit fit the cap, the cap included", () => {
    expect(capRefusal(usd(20), usd(10), usd(5), usd(5), SETTINGS)).toBeUndefined();
  });

  it("refuses a run that could pass the cap, saying what's left", () => {
    expect(capRefusal(usd(20), usd(12.5), usd(5), usd(5), SETTINGS)).toBe(`this run may cost up to $5.00, and your monthly cap of $20.00 has $2.50 left: raise it on macaron (${SETTINGS}), or wait for next month`);
    expect(capRefusal(usd(20), usd(25), usd(0), usd(1), SETTINGS)).toMatch(/has \$0\.00 left/);
  });
});

describe("monthStart", () => {
  it("is the first of the month at midnight UTC", () => {
    expect(monthStart(new Date("2026-10-31T23:59:59-05:00"))).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(monthStart(new Date("2026-10-23T12:00:00Z"))).toEqual(new Date("2026-10-01T00:00:00Z"));
  });
});
