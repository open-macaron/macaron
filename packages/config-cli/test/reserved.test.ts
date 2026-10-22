import { describe, expect, it } from "vitest";
import { folderOf } from "../src/layout.ts";
import { changesReserved } from "../src/reserved.ts";

const project = (extra = "") => `project: sandbox\nowners: "@o/t"\nusers: [alice]\nbudget: { monthUsd: 10 }\nconcurrency: 1\n${extra}`;

describe("changesReserved", () => {
  it("lets owners change what they own", () => {
    expect(changesReserved(project(), project("defaults:\n  models: { review: claude-sonnet-5-5 }\n"))).toBe(false);
    expect(changesReserved(undefined, "repo: o/x\nfork: abc123-x\n")).toBe(false);
    expect(changesReserved("repo: o/x\nfork: abc123-x\ncommands: { build: npm run build }\n", "repo: o/x\nfork: abc123-x\n")).toBe(false);
  });

  it("reserves who can trigger the bot, and what it may spend or run on", () => {
    expect(changesReserved(project(), project().replace("users: [alice]", "users: [alice, mallory]"))).toBe(true);
    expect(changesReserved(project(), project().replace("monthUsd: 10", "monthUsd: 1000"))).toBe(true);
    expect(changesReserved(project(), project("defaults:\n  runsOn: self-hosted\n"))).toBe(true);
    expect(changesReserved("repo: o/x\nfork: abc123-x\n", "repo: o/x\nfork: abc123-x\nbudgets: { implement: 50 }\n")).toBe(true);
    expect(changesReserved(undefined, "repo: o/x\nfork: abc123-x\nplatforms: { windows: { runsOn: windows-2025 } }\n")).toBe(true);
    expect(changesReserved("repo: o/x\nfork: abc123-x\ncaps: { loops: 3 }\n", undefined)).toBe(true);
  });

  it("ignores key order, and reserves what it can't read", () => {
    expect(changesReserved("budget: { monthUsd: 10 }\nusers: [a]\n", "users: [a]\nbudget:\n  monthUsd: 10\n")).toBe(false);
    expect(changesReserved(project(), "users: [unterminated\n")).toBe(true);
    expect(changesReserved(project(), null)).toBe(true);
    expect(changesReserved(project(), "- a list\n")).toBe(true);
  });
});

describe("folderOf", () => {
  it("owns project folders only", () => {
    expect(folderOf("projects/sandbox/repos/x.yaml")).toEqual({ path: "projects/sandbox" });
    expect(folderOf("projects/sandbox/OWNERS.yaml")).toEqual({ path: "projects/sandbox" });
    expect(folderOf("global.yaml")).toBeUndefined();
    expect(folderOf("projects/Not_Kebab/project.yaml")).toBeUndefined();
    expect(folderOf("projects/sandbox")).toBeUndefined();
    expect(folderOf(".github/workflows/merge.yml")).toBeUndefined();
  });
});
