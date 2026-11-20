import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigTreeError, loadConfigTree, parseConfigTree, readConfigFiles } from "@open-macaron/contracts";

const repoConfigDir = join(import.meta.dirname, "fixtures", "config");

// A copy of the configuration taken when it moved to open-macaron/config, whose CI now validates the live one.
describe("a realistic configuration tree", () => {
  it("is valid", async () => {
    const snapshot = await loadConfigTree(repoConfigDir);

    expect(snapshot.repos.get("axel7083/foobar-tmp-demo")?.budgets.implement).toBe(2);
    expect(snapshot.repos.get("podman-desktop/extension-podman-quadlet")).toMatchObject({
      org: "podman-desktop",
      knowledge: "podman-desktop-extensions",
      runsOn: "ubuntu-26.04",
      environment: { source: "shared", name: "podman-desktop-extensions" },
      models: { review: "claude-sonnet-5-5" },
      contribution: { dco: true },
      fallback: false,
    });
    expect(snapshot.repos.get("podman-desktop/podman-desktop")).toMatchObject({
      org: "podman-desktop",
      knowledge: "podman-desktop",
      environment: { source: "shared", name: "podman-desktop", params: { machine: "true" } },
      budgets: { review: 1, implement: 5, verify: 4 },
      reviewCost: { baseUsd: 0.1, perRuleUsd: 0.04 },
      contribution: { dco: true },
    });
    // The test fork shares the bot's fork with upstream, and runs Podman Desktop built from it.
    expect(snapshot.repos.get("axel7083/podman-desktop")).toMatchObject({
      org: "axel7083",
      knowledge: "podman-desktop",
      environment: { source: "shared", name: "podman-desktop", params: { machine: "true" } },
      platforms: { windows: { runsOn: "windows-2025" } },
    });
    expect(snapshot.repos.get("podman-desktop/podman-desktop")?.platforms).toEqual({});
    expect(snapshot.orgFiles.get(42176370)).toBe("orgs/axel7083/org.yaml");
    expect(snapshot.orgs.get(129859460)?.fallback).toMatchObject({ environment: { name: "generic" } });
    expect(snapshot.repos.get("podman-desktop/podman-desktop")?.compact).toBe(true);
    expect(snapshot.repos.get("axel7083/podman-desktop")?.compact).toBe(false);
  });
});

describe("loadConfigTree", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function tree(files: Readonly<Record<string, string>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "macaron-config-"));
    dir = root;
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return root;
  }

  const org = (name: string, id = 1) => `org: ${name}\nid: ${String(id)}\nowners: "@o/t"\nconcurrency: 1\n`;

  async function problems(files: Readonly<Record<string, string>>): Promise<readonly string[]> {
    const root = await tree({ "global.yaml": await globalYaml(), ...files });
    try {
      await loadConfigTree(root);
    } catch (error: unknown) {
      if (error instanceof ConfigTreeError) return error.problems;
      throw error;
    }
    return [];
  }

  async function globalYaml(): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    return readFile(join(repoConfigDir, "global.yaml"), "utf8");
  }

  it("reports every problem with its file, not just the first", async () => {
    const found = await problems({
      "orgs/a/org.yaml": `${org("a")}repos:\n  x: { budgets: { implement: -1 } }\n  y: { unknownKey: true }\n`,
      "orgs/b/org.yaml": `${org("b", 2)}fallback: { environment: { source: upstream } }\n`,
    });

    expect(found).toHaveLength(3);
    expect(found.some((problem) => problem.startsWith("orgs/a/org.yaml: repos.x.budgets.implement"))).toBe(true);
    expect(found.some((problem) => problem.startsWith("orgs/a/org.yaml: repos.y"))).toBe(true);
    expect(found.some((problem) => problem.startsWith("orgs/b/org.yaml: fallback: after merging defaults: environment.path"))).toBe(true);
  });

  it("rejects an account configured twice, by id or by login", async () => {
    expect(await problems({ "orgs/a/org.yaml": org("a", 7), "orgs/b/org.yaml": org("b", 7) })).toEqual([
      "orgs/b/org.yaml: account 7 is already configured by orgs/a/org.yaml",
    ]);
    expect(await problems({ "orgs/A/org.yaml": org("A", 1), "orgs/a/org.yaml": org("a", 2) })).toEqual([expect.stringContaining("a is already configured")]);
  });

  it("rejects an org living in a folder with another name", async () => {
    const found = await problems({ "orgs/a/org.yaml": org("b") });

    expect(found).toEqual([expect.stringContaining("must live in orgs/b/")]);
  });

  it("refuses a leftover projects/ tree, pointing to orgs/", async () => {
    const found = await problems({ "projects/a/project.yaml": "project: a\n" });

    expect(found).toEqual(["projects/a/project.yaml: projects are gone: configure the repository in orgs/<org>/org.yaml"]);
  });

  it("rejects duplicate YAML keys", async () => {
    const found = await problems({ "orgs/a/org.yaml": `${org("a")}concurrency: 2\n` });

    expect(found).toEqual([expect.stringContaining("orgs/a/org.yaml")]);
  });
});

describe("parseConfigTree", () => {
  const org = `org: a\nid: 1\nowners: "@o/t"\nconcurrency: 1\n`;

  function problems(files: Readonly<Record<string, string>>): readonly string[] {
    try {
      parseConfigTree(new Map(Object.entries(files)));
    } catch (error: unknown) {
      if (error instanceof ConfigTreeError) return error.problems;
      throw error;
    }
    return [];
  }

  it("gives a published snapshot the same result as the directory it was made from", async () => {
    const files = await readConfigFiles(repoConfigDir);

    expect(parseConfigTree(files)).toEqual(await loadConfigTree(repoConfigDir));
  });

  it("rejects files outside the layout", async () => {
    const global = (await readConfigFiles(repoConfigDir)).get("global.yaml") ?? "";

    expect(problems({ "global.yaml": global, "orgs/a/org.yaml": org, "orgs/a/notes.md": "x", "README.md": "x" })).toEqual([
      expect.stringMatching(/^README\.md: not a configuration file/),
      expect.stringMatching(/^orgs\/a\/notes\.md: not a configuration file/),
    ]);
  });

  it("accepts a configuration without the deprecated per-mode models", async () => {
    const global = (await readConfigFiles(repoConfigDir)).get("global.yaml") ?? "";
    const withoutModels = global.replace(/^ {2}models:\n( {4}.*\n)+/m, "");
    expect(withoutModels).not.toMatch(/^ {2}models:/m);

    const files = new Map(Object.entries({ "global.yaml": withoutModels, "orgs/a/org.yaml": `${org}repos:\n  r: {}\n` }));
    expect(parseConfigTree(files).repos.get("a/r")?.models).toEqual({});
  });

  it("reports a missing global.yaml", () => {
    expect(problems({ "orgs/a/org.yaml": org })).toEqual(["global.yaml: missing"]);
  });
});
