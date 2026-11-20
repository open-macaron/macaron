import { describe, expect, it } from "vitest";
import { GlobalFile, OrgFile, type RepoConfig, RepoSettingsPatch, RepoSlug, platformsOf, resolveRepoConfig, runnerFor } from "../src/index.ts";

const global = GlobalFile.parse({
  defaults: {
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
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

const org = OrgFile.parse({
  org: "podman-desktop",
  id: 129859460,
  owners: "@open-macaron/podman-desktop",
  concurrency: 4,
  defaults: {
    environment: { source: "shared", name: "pd-extension", params: { host: "podman-desktop/podman-desktop", hostRef: "auto" } },
    contribution: { dco: true },
  },
});

/** `entry` as the org's listing of `name`, resolved for `podman-desktop/<name>`. */
function resolve(entry: unknown, name = "extension-a", base: OrgFile = org): RepoConfig | undefined {
  return resolveRepoConfig(global, { ...base, repos: { ...base.repos, [name]: RepoSettingsPatch.parse(entry) } }, RepoSlug.parse(`podman-desktop/${name}`));
}

describe("resolveRepoConfig", () => {
  it("inherits the org's defaults and merges objects key by key", () => {
    const config = resolve({ budgets: { implement: 8 } });

    expect(config?.environment).toEqual({
      source: "shared",
      name: "pd-extension",
      params: { host: "podman-desktop/podman-desktop", hostRef: "auto" },
    });
    expect(config?.budgets.implement).toBe(8);
    expect(config?.budgets.plan).toBe(1);
    expect(resolve({ reviewCost: { perRuleUsd: 0.06 } })?.reviewCost).toEqual({ baseUsd: 0.1, perRuleUsd: 0.06 });
    expect(config?.contribution).toEqual({ dco: true, fixCi: false });
    expect(config).toMatchObject({ org: "podman-desktop", orgId: 129859460, knowledge: "podman-desktop", fallback: false });
  });

  it("matches a listed repository case-insensitively, under the caller's owner login", () => {
    const listed = { ...org, repos: { "Extension-A": {} } };

    expect(resolveRepoConfig(global, listed, RepoSlug.parse("renamed-org/extension-a"))).toMatchObject({ repo: "renamed-org/extension-a", org: "podman-desktop", fallback: false });
  });

  it("takes no repository the org doesn't list, unless it has a fallback", () => {
    expect(resolveRepoConfig(global, org, RepoSlug.parse("podman-desktop/unknown"))).toBeUndefined();

    const open = OrgFile.parse({ ...org, fallback: { environment: { source: "shared", name: "generic", params: {} }, caps: { perRepoMonthUsd: 5 } } });
    const config = resolveRepoConfig(global, open, RepoSlug.parse("podman-desktop/unknown"));

    expect(config).toMatchObject({ fallback: true, environment: { source: "shared", name: "generic", params: {} }, caps: { perRepoMonthUsd: 5, perThreadUsd: 20 } });
    // A listed repository never falls back.
    expect(resolve({}, "extension-a", open)?.fallback).toBe(false);
  });

  it("takes the knowledge folder from the settings, the org's login otherwise", () => {
    expect(resolve({ knowledge: "podman-desktop-extensions" })?.knowledge).toBe("podman-desktop-extensions");
    expect(resolve({}, "extension-a", OrgFile.parse({ ...org, defaults: { ...org.defaults, knowledge: "pd" } }))?.knowledge).toBe("pd");
  });

  it("is compact unless the org or a repository says otherwise", () => {
    const verbose = OrgFile.parse({ ...org, defaults: { ...org.defaults, compact: false } });

    expect(resolve({})?.compact).toBe(true);
    expect(resolve({}, "extension-c", verbose)?.compact).toBe(false);
    expect(resolve({ compact: true }, "extension-c", verbose)?.compact).toBe(true);
    expect(() => RepoSettingsPatch.parse({ compact: "yes" })).toThrow(/compact/);
  });

  it("refuses a users list: who may trigger the bot is an account of the web app", () => {
    expect(() => OrgFile.parse({ ...org, users: ["axel7083"] })).toThrow(/users/);
  });

  it("has no org budget: every run is billed to its payer's key, under their own cap", () => {
    expect(OrgFile.safeParse({ ...org, budget: { monthUsd: 10 } }).success).toBe(false);
    expect(OrgFile.safeParse({ ...org, fallback: { budget: { monthUsd: 10 } } }).success).toBe(false);
    expect(OrgFile.parse({ ...org, fallback: false }).fallback).toBe(false);
  });

  it("overrides a single shared parameter without dropping the others", () => {
    expect(resolve({ environment: { params: { hostRef: "v1.22.0" } } }, "extension-b")?.environment).toEqual({
      source: "shared",
      name: "pd-extension",
      params: { host: "podman-desktop/podman-desktop", hostRef: "v1.22.0" },
    });
  });

  it("starts the environment from scratch when the source changes", () => {
    expect(resolve({ environment: { source: "upstream", path: ".github/macaron/env" } }, "podman-desktop")?.environment).toEqual({
      source: "upstream",
      path: ".github/macaron/env",
      params: {},
    });
  });

  it("rejects an incomplete environment with a precise path", () => {
    expect(() => resolve({ environment: { source: "upstream" } }, "podman-desktop")).toThrow(/path/);
  });

  it("rejects upstream paths outside .github/macaron", () => {
    expect(RepoSettingsPatch.safeParse({ environment: { source: "upstream", path: ".github/macaron/../../x" } }).success).toBe(false);
    expect(RepoSettingsPatch.safeParse({ environment: { source: "upstream", path: "scripts/env" } }).success).toBe(false);
  });

  it("refuses the per-mode models it no longer has: each user picks their review model", () => {
    expect(RepoSettingsPatch.safeParse({ models: { review: "anthropic/claude-haiku-5.5" } }).success).toBe(false);
  });

  it("runs on Linux by default, and on the other platforms a level enables", () => {
    const linuxOnly = resolve({});
    if (linuxOnly === undefined) throw new Error("not resolved");
    expect(runnerFor(linuxOnly, "linux")).toBe("ubuntu-24.04");
    expect(runnerFor(linuxOnly, "windows")).toBeUndefined();
    expect(platformsOf(linuxOnly)).toEqual(["linux"]);

    const withWindows = resolve(
      { platforms: { windows: { runsOn: "windows-2025" } } },
      "extension-a",
      OrgFile.parse({ ...org, defaults: { ...org.defaults, platforms: { windows: { runsOn: "windows-2022" } } } }),
    );
    if (withWindows === undefined) throw new Error("not resolved");
    expect(runnerFor(withWindows, "windows")).toBe("windows-2025");
    expect(platformsOf(withWindows)).toEqual(["linux", "windows"]);
  });

  it("rejects Linux under platforms and platforms without a runner", () => {
    expect(RepoSettingsPatch.safeParse({ platforms: { linux: { runsOn: "ubuntu-24.04" } } }).success).toBe(false);
    expect(() => resolve({ platforms: { windows: {} } })).toThrow(/runsOn/);
  });

  it("rejects unknown keys so typos never pass silently", () => {
    expect(RepoSettingsPatch.safeParse({ budget: { implement: 1 } }).success).toBe(false);
    expect(OrgFile.safeParse({ ...org, repos: { "a/b": {} } }).success).toBe(false);
  });
});
