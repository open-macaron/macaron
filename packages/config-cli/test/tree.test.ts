import { cp, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommitSha, loadConfigTree, parseConfigTree, PublishedConfig } from "@open-macaron/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { publish } from "../src/publish.ts";
import { loadRepository } from "../src/tree.ts";

const committedConfig = join(import.meta.dirname, "..", "..", "contracts", "test", "fixtures", "config");
const OWNERS = "owners:\n  - login: axel7083\n    id: 42176370\n";

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** macaron's config/ laid out as open-macaron/config: each project folder with its OWNERS.yaml. */
async function repository(extra: Readonly<Record<string, string>> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "config-repo-"));
  dir = root;
  await cp(committedConfig, root, { recursive: true });
  for (const project of ["podman-desktop", "podman-desktop-extensions", "sandbox"]) await writeFile(join(root, "projects", project, "OWNERS.yaml"), OWNERS);
  await writeFile(join(root, "README.md"), "# config\n");
  for (const [path, content] of Object.entries(extra)) await writeFile(join(root, path), content);
  return root;
}

describe("loadRepository", () => {
  it("accepts the configuration the controller accepts, with its owners", async () => {
    const loaded = await loadRepository(await repository());

    expect(loaded.problems).toEqual([]);
    expect(loaded.folders.map((folder) => folder.path)).toEqual(["projects/podman-desktop", "projects/podman-desktop-extensions", "projects/sandbox"]);
    expect(parseConfigTree(loaded.files)).toEqual(await loadConfigTree(committedConfig));
  });

  it("reports stray files, missing owners and invalid configuration with their paths", async () => {
    const root = await repository({ "notes.txt": "x" });
    await rm(join(root, "projects", "sandbox", "OWNERS.yaml"));
    await writeFile(join(root, "projects", "sandbox", "repos", "broken.yaml"), "repo: not a slug\n");

    const paths = (await loadRepository(root)).problems.map((problem) => problem.path);

    expect(paths).toContain("notes.txt");
    expect(paths).toContain("projects/sandbox/OWNERS.yaml");
    expect(paths).toContain("projects/sandbox/repos/broken.yaml");
  });
});

describe("publish", () => {
  it("writes a snapshot that validates to the same configuration, byte-stable", async () => {
    const root = await repository();
    const loaded = await loadRepository(root);
    const commit = CommitSha.parse("c".repeat(40));

    await publish(loaded.files, commit, join(root, "out"));
    const first = await readFile(join(root, "out", "v1", "config.json"), "utf8");
    await publish(new Map([...loaded.files].reverse()), commit, join(root, "out"));
    const snapshot = PublishedConfig.parse(JSON.parse(first));

    expect(await readFile(join(root, "out", "v1", "config.json"), "utf8")).toBe(first);
    expect(snapshot.commit).toBe(commit);
    expect(Object.keys(snapshot.files)).not.toContain("projects/sandbox/OWNERS.yaml");
    expect(parseConfigTree(new Map(Object.entries(snapshot.files)))).toEqual(await loadConfigTree(committedConfig));
  });
});
