import { MAX_TIMEOUT_MINUTES } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { SETTLE_MAX_WAIT_MS } from "../../src/budget/settlement.ts";
import { KEY_MAX_AGE_MS } from "../../src/runs/housekeeping.ts";
import { KEY_GRACE_MINUTES } from "../../src/runs/run-launcher.ts";

describe("KEY_MAX_AGE_MS", () => {
  it("outlives the longest run, its key's grace and settlement, so the sweeper never deletes a settling run's key", () => {
    expect(KEY_MAX_AGE_MS).toBeGreaterThan((MAX_TIMEOUT_MINUTES + KEY_GRACE_MINUTES) * 60_000 + SETTLE_MAX_WAIT_MS);
  });
});
