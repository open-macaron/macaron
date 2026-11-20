import { describe, expect, it } from "vitest";
import { folderOf } from "../src/layout.ts";
import { changesReserved } from "../src/reserved.ts";

const org = (extra = "") => `org: sandbox\nid: 1\nowners: "@o/t"\nbots: [alice]\nconcurrency: 1\n${extra}`;

describe("changesReserved", () => {
  it("lets owners change what they own", () => {
    expect(changesReserved(org(), org("defaults:\n  model: claude-sonnet-5-5\n"))).toBe(false);
    expect(changesReserved(org(), org("repos:\n  x: { commands: { build: npm run build } }\n"))).toBe(false);
    expect(changesReserved(org("repos:\n  x: {}\n"), org("repos:\n  y:\n"))).toBe(false);
    expect(changesReserved(org("repos:\n  x: { budgets: { implement: 9 } }\n"), org("repos:\n  X: { budgets: { implement: 9 }, commands: { test: npm test } }\n"))).toBe(false);
  });

  it("reserves who can trigger the bot, and what it may spend or run on", () => {
    expect(changesReserved(org(), org().replace("bots: [alice]", "bots: [alice, mallory]"))).toBe(true);
    expect(changesReserved(org(), org().replace("concurrency: 1", "concurrency: 9"))).toBe(true);
    expect(changesReserved(org(), org("defaults:\n  runsOn: self-hosted\n"))).toBe(true);
    expect(changesReserved(org(), org("repos:\n  x: { budgets: { implement: 50 } }\n"))).toBe(true);
    expect(changesReserved(org(), org("repos:\n  x: { platforms: { windows: { runsOn: windows-2025 } } }\n"))).toBe(true);
    expect(changesReserved(org("repos:\n  x: { caps: { openPrs: 3 } }\n"), org())).toBe(true);
    // A new org is the platform team's.
    expect(changesReserved(undefined, org())).toBe(true);
  });

  it("reserves the account an org file trusts, and its fallback as a whole", () => {
    expect(changesReserved(org(), org().replace("id: 1", "id: 2"))).toBe(true);
    expect(changesReserved(org(), org("fallback: { environment: { source: shared, name: generic, params: {} } }\n"))).toBe(true);
    expect(changesReserved(org("fallback: {}\n"), org("fallback: { commands: { test: x } }\n"))).toBe(true);
    expect(changesReserved(org("fallback: {}\n"), org("fallback: false\n"))).toBe(true);
  });

  it("ignores key order, and reserves what it can't read", () => {
    expect(changesReserved("caps: { openPrs: 3, reviewLoops: 6 }\nbots: [a]\n", "bots: [a]\ncaps:\n  reviewLoops: 6\n  openPrs: 3\n")).toBe(false);
    expect(changesReserved(org(), "bots: [unterminated\n")).toBe(true);
    expect(changesReserved(org(), null)).toBe(true);
    expect(changesReserved(org(), "- a list\n")).toBe(true);
    expect(changesReserved(org(), org("repos: [x]\n"))).toBe(true);
    expect(changesReserved(org(), org("repos:\n  x: [a]\n"))).toBe(true);
  });
});

describe("folderOf", () => {
  it("owns org folders only", () => {
    expect(folderOf("orgs/podman-desktop/org.yaml")).toEqual({ path: "orgs/podman-desktop" });
    expect(folderOf("orgs/axel7083/OWNERS.yaml")).toEqual({ path: "orgs/axel7083" });
    expect(folderOf("global.yaml")).toBeUndefined();
    expect(folderOf("orgs/not_a_login/org.yaml")).toBeUndefined();
    expect(folderOf("orgs/sandbox")).toBeUndefined();
    expect(folderOf("projects/sandbox/project.yaml")).toBeUndefined();
    expect(folderOf(".github/workflows/merge.yml")).toBeUndefined();
  });
});
