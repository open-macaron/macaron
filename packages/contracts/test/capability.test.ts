import { describe, expect, it } from "vitest";
import { Capability, Mode, requiredCapability } from "../src/index.ts";

describe("requiredCapability", () => {
  it("names a capability for every mode", () => {
    for (const mode of Mode.options) expect(Capability.options).toContain(requiredCapability[mode]);
  });

  it("leaves no capability that no mode needs", () => {
    expect(new Set(Object.values(requiredCapability))).toEqual(new Set(Capability.options));
  });

  it("asks implement for replying to review comments, remember for retro", () => {
    expect(requiredCapability.address_review).toBe("implement");
    expect(requiredCapability.retro).toBe("remember");
  });
});
