import { Capability, Mode } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { askedBy, capabilityRefusal } from "../../src/accounts/access.ts";

const WEB = "https://macaron.example.test";
const isBot = (login: string): boolean => login.toLowerCase() === "coderabbitai[bot]";

describe("askedBy", () => {
  it("is the latest person who asked in the batch", () => {
    expect(askedBy([{ author: "alice", authorId: 1 }, { author: "bob", authorId: 2 }], isBot, 9)).toBe(2);
  });

  it("skips review bots and authors GitHub no longer knows", () => {
    expect(askedBy([{ author: "alice", authorId: 1 }, { author: "coderabbitai[bot]", authorId: 3 }, { author: "ghost", authorId: null }], isBot, 9)).toBe(1);
  });

  it("is the thread's previous asker when only review bots commented", () => {
    expect(askedBy([{ author: "coderabbitai[bot]", authorId: 3 }], isBot, 9)).toBe(9);
  });

  it("is nobody when nobody can be named", () => {
    expect(askedBy([{ author: "coderabbitai[bot]", authorId: 3 }], isBot, null)).toBeUndefined();
    expect(askedBy([], isBot, undefined)).toBeUndefined();
  });
});

describe("capabilityRefusal", () => {
  it("lets every mode run for someone holding its capability", () => {
    for (const mode of Mode.options) expect(capabilityRefusal({ userId: "u1", githubId: 1, capabilities: Capability.options }, mode, WEB), mode).toBeUndefined();
  });

  it("refuses a mode whose capability the account lacks, naming it", () => {
    expect(capabilityRefusal({ userId: "u1", githubId: 1, capabilities: ["triage"] }, "implement", WEB)).toBe(`this account can't ask for \`implement\`: an administrator grants it on macaron (${WEB})`);
  });

  it("asks implement for addressing review comments, remember for retro", () => {
    expect(capabilityRefusal({ userId: "u1", githubId: 1, capabilities: ["review"] }, "address_review", WEB)).toMatch(/`implement`/);
    expect(capabilityRefusal({ userId: "u1", githubId: 1, capabilities: ["implement"] }, "address_review", WEB)).toBeUndefined();
    expect(capabilityRefusal({ userId: "u1", githubId: 1, capabilities: ["triage"] }, "retro", WEB)).toMatch(/`remember`/);
  });

  it("refuses someone without an account, pointing to the web app", () => {
    expect(capabilityRefusal(undefined, "triage", WEB)).toBe(`this needs an account on macaron: ask an administrator for an invitation (${WEB})`);
  });

  it("never mentions anyone", () => {
    expect(capabilityRefusal({ userId: "u1", githubId: 1, capabilities: [] }, "plan", WEB)).not.toMatch(/@/);
  });
});
