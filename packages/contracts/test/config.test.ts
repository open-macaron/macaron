import { describe, expect, it } from "vitest";
import { GlobalFile, ProjectFile, RepoFile, platformsOf, resolveRepoConfig, runnerFor } from "../src/index.ts";

const global = GlobalFile.parse({
  defaults: {
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
    models: { review: "anthropic/claude-haiku-5.5" },
    fastModel: "anthropic/claude-haiku-5.5",
    runsOn: "ubuntu-24.04",
    draftPr: true,
    timeoutMinutes: 60,
    budgets: { triage: 0.2, plan: 1, implement: 5, address_review: 2, reproduce: 3, verify: 3, retro: 0.5, review: 0.5 },
    reviewCost: { baseUsd: 0.1, perRuleUsd: 0.04 },
    caps: { perThreadUsd: 20, perRepoMonthUsd: 150, reviewLoops: 6, botReviewLoops: 2, openPrs: 3 },
    environment: { source: "shared", name: "generic", params: {} },
    commands: {},
    contribution: { dco: false, fixCi: false },
  },
  routerModel: "anthropic/claude-haiku-5.5",
  concurrency: { global: 10 },
  platformTeam: "@open-macaron/maintainers",
});

const project = ProjectFile.parse({
  project: "podman-desktop",
  owners: "@open-macaron/podman-desktop",
  budget: { monthUsd: 300 },
  concurrency: 4,
  defaults: {
    environment: { source: "shared", name: "pd-extension", params: { host: "podman-desktop/podman-desktop", hostRef: "auto" } },
    contribution: { dco: true },
  },
});

describe("resolveRepoConfig", () => {
  it("inherits project defaults and merges objects key by key", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/extension-a", budgets: { implement: 8 } });

    const config = resolveRepoConfig(global, project, repo);

    expect(config.environment).toEqual({
      source: "shared",
      name: "pd-extension",
      params: { host: "podman-desktop/podman-desktop", hostRef: "auto" },
    });
    expect(config.budgets.implement).toBe(8);
    expect(config.budgets.plan).toBe(1);
    expect(resolveRepoConfig(global, project, RepoFile.parse({ ...repo, reviewCost: { perRuleUsd: 0.06 } })).reviewCost).toEqual({ baseUsd: 0.1, perRuleUsd: 0.06 });
    expect(config.contribution).toEqual({ dco: true, fixCi: false });
  });

  it("ignores a fork named by the file: the controller owns the bot's forks", () => {
    const config = resolveRepoConfig(global, project, RepoFile.parse({ repo: "podman-desktop/extension-a", fork: "macaron-bot/knowledge" }));

    expect(config).not.toHaveProperty("fork");
  });

  it("is compact unless a project or a repository says otherwise", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/extension-c" });
    const verbose = ProjectFile.parse({ ...project, defaults: { ...project.defaults, compact: false } });

    expect(resolveRepoConfig(global, project, repo).compact).toBe(true);
    expect(resolveRepoConfig(global, verbose, repo).compact).toBe(false);
    expect(resolveRepoConfig(global, verbose, RepoFile.parse({ ...repo, compact: true })).compact).toBe(true);
    expect(() => RepoFile.parse({ ...repo, compact: "yes" })).toThrow(/compact/);
  });

  it("refuses a users list: who may trigger the bot is an account of the web app", () => {
    expect(() => ProjectFile.parse({ ...project, users: ["axel7083"] })).toThrow(/users/);
  });

  it("overrides a single shared parameter without dropping the others", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/extension-b", environment: { params: { hostRef: "v1.22.0" } } });

    const config = resolveRepoConfig(global, project, repo);

    expect(config.environment).toEqual({
      source: "shared",
      name: "pd-extension",
      params: { host: "podman-desktop/podman-desktop", hostRef: "v1.22.0" },
    });
  });

  it("starts the environment from scratch when the source changes", () => {
    const repo = RepoFile.parse({
      repo: "podman-desktop/podman-desktop",
      environment: { source: "upstream", path: ".github/macaron/env" },
    });

    const config = resolveRepoConfig(global, project, repo);

    expect(config.environment).toEqual({ source: "upstream", path: ".github/macaron/env", params: {} });
  });

  it("rejects an incomplete environment with a precise path", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/podman-desktop", environment: { source: "upstream" } });

    expect(() => resolveRepoConfig(global, project, repo)).toThrow(/path/);
  });

  it("rejects upstream paths outside .github/macaron", () => {
    expect(RepoFile.safeParse({ repo: "a/b", environment: { source: "upstream", path: ".github/macaron/../../x" } }).success).toBe(false);
    expect(RepoFile.safeParse({ repo: "a/b", environment: { source: "upstream", path: "scripts/env" } }).success).toBe(false);
  });

  it("merges per-mode model overrides and rejects unknown modes", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/extension-a", models: { implement: "anthropic/claude-opus-5.5" } });
    const config = resolveRepoConfig(global, project, repo);

    expect(config.models).toEqual({ review: "anthropic/claude-haiku-5.5", implement: "anthropic/claude-opus-5.5" });
    expect(RepoFile.safeParse({ repo: "o/r", models: { reviw: "m" } }).success).toBe(false);
  });

  it("runs on Linux by default, and on the other platforms a level enables", () => {
    const linuxOnly = resolveRepoConfig(global, project, RepoFile.parse({ repo: "podman-desktop/extension-a" }));
    expect(runnerFor(linuxOnly, "linux")).toBe("ubuntu-24.04");
    expect(runnerFor(linuxOnly, "windows")).toBeUndefined();
    expect(platformsOf(linuxOnly)).toEqual(["linux"]);

    const withWindows = resolveRepoConfig(
      global,
      ProjectFile.parse({ ...project, defaults: { ...project.defaults, platforms: { windows: { runsOn: "windows-2022" } } } }),
      RepoFile.parse({ repo: "podman-desktop/extension-a", platforms: { windows: { runsOn: "windows-2025" } } }),
    );
    expect(runnerFor(withWindows, "windows")).toBe("windows-2025");
    expect(platformsOf(withWindows)).toEqual(["linux", "windows"]);
  });

  it("rejects Linux under platforms and platforms without a runner", () => {
    expect(RepoFile.safeParse({ repo: "a/b", platforms: { linux: { runsOn: "ubuntu-24.04" } } }).success).toBe(false);
    const repo = RepoFile.parse({ repo: "a/b", platforms: { windows: {} } });
    expect(() => resolveRepoConfig(global, project, repo)).toThrow(/runsOn/);
  });

  it("rejects unknown keys so typos never pass silently", () => {
    expect(RepoFile.safeParse({ repo: "a/b", budget: { implement: 1 } }).success).toBe(false);
  });
});
