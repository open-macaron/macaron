import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigTreeError, loadConfigTree } from "../../src/config/config-tree.ts";

const repoConfigDir = join(import.meta.dirname, "..", "..", "..", "..", "config");

describe("the committed config/ tree", () => {
  it("is valid", async () => {
    const snapshot = await loadConfigTree(repoConfigDir);

    expect(snapshot.repos.get("axel7083/foobar-tmp-demo")?.budgets.implement).toBe(2);
    expect(snapshot.repos.get("axel7083/extension-podman-quadlet")).toMatchObject({
      project: "podman-desktop-extensions",
      runsOn: "ubuntu-26.04",
      capabilities: ["gui"],
      environment: { source: "shared", name: "podman-desktop-extensions" },
      models: { review: "claude-haiku-4-5" },
    });
    expect(snapshot.repos.get("podman-desktop/podman-desktop")).toMatchObject({
      project: "podman-desktop",
      capabilities: [],
      budgets: { review: 1, implement: 5 },
      reviewCost: { baseUsd: 0.1, perRuleUsd: 0.04 },
      contribution: { dco: true },
    });
    // The test fork shares the bot's fork with upstream, and runs Podman Desktop built from it.
    expect(snapshot.repos.get("axel7083/podman-desktop")).toMatchObject({
      project: "podman-desktop",
      fork: "2elnuw-podman-desktop",
      environment: { source: "shared", name: "podman-desktop", params: { machine: "true" } },
      capabilities: ["gui"],
    });
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

  const project = (name: string) => `project: ${name}\nowners: "@o/t"\nusers: [alice]\nbudget: { monthUsd: 10 }\nconcurrency: 1\n`;

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
      "projects/a/project.yaml": project("a"),
      "projects/a/repos/x.yaml": "repo: o/x\nfork: abc123-x\nbudgets: { implement: -1 }\n",
      "projects/a/repos/y.yaml": "repo: o/y\nfork: abc123-y\nunknownKey: true\n",
    });

    expect(found).toHaveLength(2);
    expect(found.some((problem) => problem.startsWith("projects/a/repos/x.yaml: budgets.implement"))).toBe(true);
    expect(found.some((problem) => problem.startsWith("projects/a/repos/y.yaml"))).toBe(true);
  });

  it("rejects a repository configured by two projects, case-insensitively", async () => {
    const found = await problems({
      "projects/a/project.yaml": project("a"),
      "projects/a/repos/x.yaml": "repo: Org/Repo\nfork: abc123-repo\n",
      "projects/b/project.yaml": project("b"),
      "projects/b/repos/x.yaml": "repo: org/repo\nfork: abc123-repo\n",
    });

    expect(found).toEqual([expect.stringContaining('already configured by project "a"')]);
  });

  it("rejects a project living in a folder with another name", async () => {
    const found = await problems({ "projects/a/project.yaml": project("b") });

    expect(found).toEqual([expect.stringContaining("must live in projects/b/")]);
  });

  it("rejects duplicate YAML keys", async () => {
    const found = await problems({ "projects/a/project.yaml": `${project("a")}concurrency: 2\n` });

    expect(found).toEqual([expect.stringContaining("projects/a/project.yaml")]);
  });
});
