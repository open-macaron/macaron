import { describe, expect, it } from "vitest";
import { BotBranch } from "@open-macaron/contracts";
import { branchFor, decideMode, parseMention, parseSubjectUrl } from "../../src/ingest/triggers.ts";

describe("parseSubjectUrl", () => {
  it("reads issues and pull requests", () => {
    expect(parseSubjectUrl("https://api.github.com/repos/org-x/repo-a/issues/12")).toEqual({ repo: "org-x/repo-a", number: 12, kind: "issue" });
    expect(parseSubjectUrl("https://api.github.com/repos/org-x/repo.js/pulls/40")).toEqual({ repo: "org-x/repo.js", number: 40, kind: "pull" });
  });

  it("ignores anything else", () => {
    expect(parseSubjectUrl("https://api.github.com/repos/org-x/repo-a/releases/1")).toBeUndefined();
    expect(parseSubjectUrl(null)).toBeUndefined();
  });
});

describe("parseMention", () => {
  it.each([
    ["@macaron-bot implement", "implement"],
    ["@Macaron-Bot PLAN please", "plan"],
    ["hey @macaron-bot can you reproduce?", "reproduce"],
    ["@macaron-bot please try the fix", "verify"],
    ["@macaron-bot stop", "stop"],
    ["@macaron-bot retry", "retry"],
    ["@macaron-bot review", "review"],
    ["@macaron-bot could you try again?", "retry"],
  ])("reads %j as %s", (body, command) => {
    expect(parseMention(body, "macaron-bot")?.command).toBe(command);
  });

  it("returns no command for a bare mention, so triage decides", () => {
    expect(parseMention("@macaron-bot what do you think about this approach?", "macaron-bot")).toEqual({
      command: undefined,
      platform: undefined,
      instruction: "what do you think about this approach?",
    });
  });

  it.each([
    ["@macaron-bot reproduce on windows", "reproduce", "windows"],
    ["@macaron-bot implement on Windows, the path separator is wrong", "implement", "windows"],
    ["hey @macaron-bot can you reproduce this on WINDOWS?", "reproduce", "windows"],
    ["@macaron-bot verify on macos", "verify", "macos"],
    ["@macaron-bot reproduce", "reproduce", undefined],
    ["@macaron-bot reproduce on wsl", "reproduce", undefined],
    ["@macaron-bot it fails on windows", undefined, undefined],
  ])("reads the platform of %j", (body, command, platform) => {
    expect(parseMention(body, "macaron-bot")).toMatchObject({ command, platform });
  });

  it("ignores mentions in code, quotes and other logins", () => {
    expect(parseMention("`@macaron-bot implement`", "macaron-bot")).toBeUndefined();
    expect(parseMention("```\n@macaron-bot implement\n```", "macaron-bot")).toBeUndefined();
    expect(parseMention("> @macaron-bot implement", "macaron-bot")).toBeUndefined();
    expect(parseMention("@macaron-bot-fan implement", "macaron-bot")).toBeUndefined();
    expect(parseMention("mail admin@macaron-bot.dev", "macaron-bot")).toBeUndefined();
  });
});

describe("branchFor", () => {
  it("builds a stable, safe branch name", () => {
    expect(branchFor(12, "Crash on start (Électron 38)!")).toBe("macaron/12-crash-on-start-electron-38");
    expect(branchFor(12, "Crash on start (Électron 38)!", 7)).toBe("macaron/12-crash-on-start-electron-38-7");
    expect(BotBranch.safeParse(branchFor(12, "x".repeat(80), 9999)).success).toBe(true);
    expect(branchFor(7, "🔥🔥")).toBe("macaron/7-work");
  });
});

describe("decideMode", () => {
  it("prefers the latest explicit command", () => {
    expect(decideMode([{ kind: "mention", command: "plan" }, { kind: "mention", command: "implement" }])).toBe("implement");
  });

  it("maps inline review comments to address_review, and anything else to triage", () => {
    expect(decideMode([{ kind: "review", command: undefined }, { kind: "comment", command: undefined }])).toBe("address_review");
    expect(decideMode([{ kind: "comment", command: undefined }])).toBe("triage");
  });
});
