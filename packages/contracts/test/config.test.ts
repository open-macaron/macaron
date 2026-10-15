import { describe, expect, it } from "vitest";
import { GlobalFile, ProjectFile, RepoFile, resolveRepoConfig } from "../src/index.ts";

const global = GlobalFile.parse({
  defaults: {
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
    runsOn: "ubuntu-24.04",
    draftPr: true,
    timeoutMinutes: 60,
    budgets: { triage: 0.2, plan: 1, implement: 5, address_review: 2, reproduce: 3, verify: 3, retro: 0.5 },
    caps: { perThreadUsd: 20, perRepoMonthUsd: 150, reviewLoops: 6, botReviewLoops: 2, openPrs: 3 },
    environment: { source: "shared", name: "generic", params: {} },
    commands: {},
    capabilities: [],
    contribution: { dco: false, fixCi: false },
  },
  routerModel: "anthropic/claude-haiku-5.5",
  concurrency: { global: 10 },
  platformTeam: "@open-macaron/maintainers",
});

const project = ProjectFile.parse({
  project: "podman-desktop",
  owners: "@open-macaron/podman-desktop",
  users: ["axel7083"],
  budget: { monthUsd: 300 },
  concurrency: 4,
  defaults: {
    environment: { source: "shared", name: "pd-extension", params: { host: "podman-desktop/podman-desktop", hostRef: "auto" } },
    contribution: { dco: true },
  },
});

describe("resolveRepoConfig", () => {
  it("inherits project defaults and merges objects key by key", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/extension-a", fork: "abc123-extension-a", budgets: { implement: 8 } });

    const config = resolveRepoConfig(global, project, repo);

    expect(config.environment).toEqual({
      source: "shared",
      name: "pd-extension",
      params: { host: "podman-desktop/podman-desktop", hostRef: "auto" },
    });
    expect(config.budgets.implement).toBe(8);
    expect(config.budgets.plan).toBe(1);
    expect(config.contribution).toEqual({ dco: true, fixCi: false });
    expect(config.users).toEqual(["axel7083"]);
  });

  it("overrides a single shared parameter without dropping the others", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/extension-b", fork: "abc123-extension-b", environment: { params: { hostRef: "v1.22.0" } } });

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
      fork: "abc123-podman-desktop",
      environment: { source: "upstream", path: ".github/macaron/env" },
    });

    const config = resolveRepoConfig(global, project, repo);

    expect(config.environment).toEqual({ source: "upstream", path: ".github/macaron/env", params: {} });
  });

  it("rejects an incomplete environment with a precise path", () => {
    const repo = RepoFile.parse({ repo: "podman-desktop/podman-desktop", fork: "abc123-podman-desktop", environment: { source: "upstream" } });

    expect(() => resolveRepoConfig(global, project, repo)).toThrow(/path/);
  });

  it("rejects upstream paths outside .github/macaron", () => {
    expect(RepoFile.safeParse({ repo: "a/b", fork: "abc123-b", environment: { source: "upstream", path: ".github/macaron/../../x" } }).success).toBe(false);
    expect(RepoFile.safeParse({ repo: "a/b", fork: "abc123-b", environment: { source: "upstream", path: "scripts/env" } }).success).toBe(false);
  });

  it("rejects unknown keys so typos never pass silently", () => {
    expect(RepoFile.safeParse({ repo: "a/b", fork: "abc123-b", budget: { implement: 1 } }).success).toBe(false);
  });
});
