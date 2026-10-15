import { describe, expect, it } from "vitest";
import { decideSettlement, SETTLE_MAX_WAIT_MS } from "../../src/budget/settlement.ts";

describe("decideSettlement", () => {
  it("settles a never-redeemed key at $0 at once", () => {
    expect(decideSettlement({ redeemed: false, observedMicros: 0, previousMicros: undefined, sinceFinishMs: 0 })).toEqual({ kind: "settle", costMicros: 0 });
  });

  it("does not trust two zero readings of a redeemed key (usage arrives late)", () => {
    expect(decideSettlement({ redeemed: true, observedMicros: 0, previousMicros: 0, sinceFinishMs: 120_000 })).toEqual({ kind: "recheck", observedMicros: 0 });
  });

  it("rechecks while usage is still moving", () => {
    expect(decideSettlement({ redeemed: true, observedMicros: 31_000, previousMicros: 12_000, sinceFinishMs: 180_000 })).toEqual({ kind: "recheck", observedMicros: 31_000 });
  });

  it("settles on a non-zero reading that didn't move since the previous one", () => {
    expect(decideSettlement({ redeemed: true, observedMicros: 31_000, previousMicros: 31_000, sinceFinishMs: 240_000 })).toEqual({ kind: "settle", costMicros: 31_000 });
  });

  it("accepts whatever is reported after the maximum wait", () => {
    expect(decideSettlement({ redeemed: true, observedMicros: 0, previousMicros: 0, sinceFinishMs: SETTLE_MAX_WAIT_MS })).toEqual({ kind: "settle", costMicros: 0 });
  });
});
