import { describe, expect, it } from "vitest";
import { CapabilitiesInput, InvitationInput } from "../src/lib/admin/forms.ts";
import { formatMillions, formatUsd } from "../src/lib/format.ts";

describe("InvitationInput", () => {
  it("takes a GitHub login and deduplicated capabilities", () => {
    expect(InvitationInput.parse({ githubLogin: " octo-cat ", capabilities: ["plan", "plan", "review"] })).toEqual({ githubLogin: "octo-cat", capabilities: ["plan", "review"] });
  });

  it("refuses what GitHub wouldn't accept as a login", () => {
    for (const githubLogin of ["", "-octo", "octo-", "oc--to", "a".repeat(40), "octo cat", "@octocat"]) {
      expect(InvitationInput.safeParse({ githubLogin, capabilities: ["plan"] }).success, githubLogin).toBe(false);
    }
  });

  it("refuses an invitation without capabilities, unchecked boxes included", () => {
    expect(InvitationInput.safeParse({ githubLogin: "octocat", capabilities: [] }).success).toBe(false);
    expect(InvitationInput.safeParse({ githubLogin: "octocat" }).success).toBe(false);
    expect(InvitationInput.safeParse({ githubLogin: "octocat", capabilities: ["deploy"] }).success).toBe(false);
  });
});

describe("CapabilitiesInput", () => {
  it("needs a well-formed user id and at least one capability", () => {
    expect(CapabilitiesInput.safeParse({ userId: "aZ09_-x", capabilities: ["review"] }).success).toBe(true);
    expect(CapabilitiesInput.safeParse({ userId: "../admin", capabilities: ["review"] }).success).toBe(false);
  });
});

describe("formatUsd", () => {
  it("never shows a spend as zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1.8)).toBe("$1.80");
  });
});

describe("formatMillions", () => {
  it("shows a run's tokens in millions, never a non-zero count as zero", () => {
    expect(formatMillions(0)).toBe("0.00M");
    expect(formatMillions(4_999)).toBe("<0.01M");
    expect(formatMillions(5_000)).toBe("0.01M");
    expect(formatMillions(1_254_000)).toBe("1.25M");
  });
});
