import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CommitSha, KnowledgeIndex, KnowledgeSlice } from "@open-macaron/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { publish } from "../src/publish.ts";
import { loadTree } from "../src/tree.ts";

const OWNERS = "owners:\n  - login: axel7083\n    id: 42176370\n";
const RULE = `---
title: Import package.json instead of reading it at runtime
severity: error
applies_to: ["src/**/*.ts"]
sources:
  - https://github.com/axel7083/foobar-tmp-demo/pull/2#discussion_r4285183794
---
## Check
Does the changed code read \`package.json\` from disk at runtime?

## Violation
An added line that reads \`package.json\` with \`fs\`.

## Not a violation
\`import pkg from '../package.json'\`.

## Examples
\`\`\`ts
// ❌
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
\`\`\`
`;
const LESSON = `---
topic: Building
sources: ["https://github.com/axel7083/foobar-tmp-demo/pull/2"]
last_verified: 2026-10-15
confidence: high
---
\`npm run build\` type-checks with tsc before bundling.
`;

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "knowledge-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const valid = {
  "README.md": "# knowledge\n",
  ".github/workflows/check.yml": "on: pull_request\n",
  "global/OWNERS.yaml": OWNERS,
  "projects/sandbox/OWNERS.yaml": OWNERS,
  "projects/sandbox/rules/no-runtime-json-read.md": RULE,
  "repos/axel7083/foobar-tmp-demo/OWNERS.yaml": OWNERS,
  "repos/axel7083/foobar-tmp-demo/overview.md": "# foobar-tmp-demo\n",
  "repos/axel7083/foobar-tmp-demo/lessons/building.md": LESSON,
};

describe("loadTree", () => {
  it("accepts the documented layout and derives rule ids from folders", async () => {
    const loaded = await loadTree(await tree(valid));
    expect(loaded.problems).toEqual([]);
    expect(loaded.folders.map((folder) => folder.path)).toEqual(["global", "projects/sandbox", "repos/axel7083/foobar-tmp-demo"]);
    expect(loaded.folders[1]?.rules.map((rule) => rule.id)).toEqual(["sandbox/no-runtime-json-read"]);
    expect(loaded.folders[2]?.lessons.map((lesson) => lesson.id)).toEqual(["axel7083/foobar-tmp-demo/lessons/building"]);
  });

  it("reports every problem with its file", async () => {
    const loaded = await loadTree(
      await tree({
        "projects/sandbox/rules/missing-sections.md": "---\ntitle: t\nseverity: error\n---\n## Check\nx\n",
        "projects/sandbox/rules/bad-severity.md": RULE.replace("severity: error", "severity: fatal"),
        "projects/sandbox/rules/Bad_Name.md": RULE,
        "projects/sandbox/notes.txt": "x",
        "repos/axel7083/foobar-tmp-demo/OWNERS.yaml": "owners:\n  - login: axel7083\n",
        "global/rules/no-front-matter.md": "## Check\n",
        "global/OWNERS.yaml": OWNERS,
      }),
    );
    const byPath = (path: string) => loaded.problems.filter((problem) => problem.path === path).map((problem) => problem.message);
    expect(byPath("projects/sandbox/rules/missing-sections.md")[0]).toMatch(/exactly these "##" sections/);
    expect(byPath("projects/sandbox/rules/bad-severity.md")[0]).toMatch(/^severity:/);
    expect(byPath("projects/sandbox/rules/Bad_Name.md")[0]).toMatch(/unexpected file/);
    expect(byPath("projects/sandbox/notes.txt")[0]).toMatch(/unexpected file/);
    expect(byPath("projects/sandbox/OWNERS.yaml")[0]).toMatch(/needs an OWNERS.yaml/);
    expect(byPath("repos/axel7083/foobar-tmp-demo/OWNERS.yaml")[0]).toMatch(/^owners\.0\.id:/);
    expect(byPath("global/rules/no-front-matter.md")[0]).toMatch(/missing YAML front matter/);
  });

  it("refuses YAML aliases, globs escaping the repository, symbolic links and owners listed twice", async () => {
    const dir = await tree({
      ...valid,
      "global/OWNERS.yaml": "a: &a [1]\nowners: *a\n",
      "projects/sandbox/rules/escape.md": RULE.replace('["src/**/*.ts"]', '["../secrets/**"]'),
      "repos/axel7083/foobar-tmp-demo/OWNERS.yaml": `${OWNERS}  - login: axel-again\n    id: 42176370\n`,
    });
    await symlink("/etc/passwd", join(dir, "projects/sandbox/rules/link.md"));
    const messages = (await loadTree(dir)).problems.map((problem) => `${problem.path}: ${problem.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^global\/OWNERS\.yaml: not valid YAML/),
        expect.stringMatching(/^projects\/sandbox\/rules\/escape\.md: applies_to\.0: expected a relative glob/),
        expect.stringMatching(/^projects\/sandbox\/rules\/link\.md: symbolic links are not allowed/),
        expect.stringMatching(/^repos\/axel7083\/foobar-tmp-demo\/OWNERS\.yaml: owners: an owner is listed twice/),
      ]),
    );
  });
});

describe("publish", () => {
  it("writes one slice per folder and an index, all matching the published schemas", async () => {
    const loaded = await loadTree(await tree(valid));
    const out = join(root ?? "", "_site");
    const written = await publish(loaded, CommitSha.parse("c".repeat(40)), out);
    expect(written).toEqual(["v1/global.json", "v1/projects/sandbox.json", "v1/repos/axel7083/foobar-tmp-demo.json", "v1/index.json"]);

    const index = KnowledgeIndex.parse(JSON.parse(await readFile(join(out, "v1/index.json"), "utf8")));
    expect(index.slices.find((slice) => slice.scope === "sandbox")?.rules).toEqual([
      { id: "sandbox/no-runtime-json-read", title: "Import package.json instead of reading it at runtime", severity: "error", appliesTo: ["src/**/*.ts"] },
    ]);
    const repo = KnowledgeSlice.parse(JSON.parse(await readFile(join(out, "v1/repos/axel7083/foobar-tmp-demo.json"), "utf8")));
    expect(repo.overview).toBe("# foobar-tmp-demo");
    expect(repo.lessons[0]?.body).toBe("`npm run build` type-checks with tsc before bundling.");
  });
});
