import { describe, expect, it } from "vitest";
import { Capability, Mode, requiredCapabilities } from "../src/index.ts";

describe("requiredCapabilities", () => {
  it("names at least one capability for every mode", () => {
    for (const mode of Mode.options) {
      expect(requiredCapabilities[mode].length, mode).toBeGreaterThan(0);
      for (const capability of requiredCapabilities[mode]) expect(Capability.options).toContain(capability);
    }
  });

  it("leaves no capability that no mode needs", () => {
    expect(new Set(Object.values(requiredCapabilities).flat())).toEqual(new Set(Capability.options));
  });

  it("asks implement for replying to review comments, remember for retro, both checks for a full review", () => {
    expect(requiredCapabilities.address_review).toEqual(["implement"]);
    expect(requiredCapabilities.retro).toEqual(["remember"]);
    expect(requiredCapabilities.full_review).toEqual(["verify", "review"]);
  });
});
