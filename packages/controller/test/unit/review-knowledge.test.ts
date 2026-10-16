import { CommitSha, type KnowledgeSlice, type PublishedRule, RepoSlug, Slug } from "@open-macaron/contracts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UpstreamError } from "../../src/common/errors.ts";
import { KnowledgeClient } from "../../src/review/knowledge-client.ts";
import { diffFileFromPatch as toDiffFile, selectRules } from "@open-macaron/review";
import { testEnv } from "../support/env.ts";

const BASE = "https://knowledge.example.test/v1";
const COMMIT = CommitSha.parse("c".repeat(40));

function rule(id: string, overrides: Partial<PublishedRule> = {}): PublishedRule {
  return { id, scope: id.split("/")[0] ?? "global", title: `rule ${id}`, severity: "error", appliesTo: null, exclude: [], sources: [], body: "## Check\n…", ...overrides };
}

function slice(scope: string, rules: PublishedRule[]): KnowledgeSlice {
  return { version: 1, commit: COMMIT, scope, overview: null, rules, lessons: [] };
}

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const config = { project: Slug.parse("sandbox"), repo: RepoSlug.parse("axel7083/foobar-tmp-demo") };

describe("KnowledgeClient", () => {
  const client = () => new KnowledgeClient(testEnv({ KNOWLEDGE_URL: BASE }));

  it("merges global → project → repo, and treats a missing level as empty", async () => {
    server.use(
      http.get(`${BASE}/global.json`, () => HttpResponse.json(slice("global", [rule("global/conventional-commits")]))),
      http.get(`${BASE}/projects/sandbox.json`, () => HttpResponse.json(slice("sandbox", [rule("sandbox/no-runtime-json-read")]))),
      http.get(`${BASE}/repos/axel7083/foobar-tmp-demo.json`, () => new HttpResponse(null, { status: 404 })),
    );
    const { commit, rules } = await client().rulesFor(config);
    expect(commit).toBe(COMMIT);
    expect(rules.map((r) => r.id)).toEqual(["global/conventional-commits", "sandbox/no-runtime-json-read"]);
  });

  it("revalidates with the ETag and serves 304s from its cache", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/global.json`, ({ request }) => {
        seen.push(request.headers.get("if-none-match"));
        return seen.length === 1 ? HttpResponse.json(slice("global", [rule("global/a")]), { headers: { etag: '"v1"' } }) : new HttpResponse(null, { status: 304 });
      }),
      http.get(`${BASE}/projects/sandbox.json`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${BASE}/repos/axel7083/foobar-tmp-demo.json`, () => new HttpResponse(null, { status: 404 })),
    );
    const knowledge = client();
    await knowledge.rulesFor(config);
    const second = await knowledge.rulesFor(config);
    expect(seen).toEqual([null, '"v1"']);
    expect(second.rules.map((r) => r.id)).toEqual(["global/a"]);
  });

  it("refuses content that isn't a knowledge slice", async () => {
    server.use(
      http.get(`${BASE}/global.json`, () => HttpResponse.json({ rules: "everything is fine" })),
      http.get(`${BASE}/projects/sandbox.json`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${BASE}/repos/axel7083/foobar-tmp-demo.json`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(client().rulesFor(config)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("selectRules", () => {
  const paths = ["src/extension.ts", "src/extension.spec.ts", "README.md", ".github/workflows/ci.yml"];

  it("keeps rules whose globs match a changed file, with those files, and lists the others as skipped", () => {
    const { rules, skipped } = selectRules(
      [
        rule("sandbox/ts", { appliesTo: ["src/**/*.ts"], exclude: ["**/*.spec.ts"] }),
        rule("global/any"),
        rule("sandbox/svelte", { appliesTo: ["**/*.svelte"] }),
        rule("global/workflows", { appliesTo: ["**/*.yml"] }),
      ],
      paths,
    );
    expect(rules.map(({ rule: r, files }) => [r.id, files])).toEqual([
      ["sandbox/ts", ["src/extension.ts"]],
      ["global/any", paths],
      // `dot: true`: globs reach dot-directories like .github/.
      ["global/workflows", [".github/workflows/ci.yml"]],
    ]);
    expect(skipped).toEqual([{ id: "sandbox/svelte", title: "rule sandbox/svelte", severity: "error", reason: "no_matching_file" }]);
  });

  it("caps the number of rules per review", () => {
    const many = Array.from({ length: 45 }, (_, index) => rule(`global/r${String(index)}`));
    const { rules, skipped } = selectRules(many, ["a.ts"]);
    expect(rules).toHaveLength(40);
    expect(skipped.every((entry) => entry.reason === "over_limit")).toBe(true);
    expect(skipped).toHaveLength(5);
  });
});

describe("toDiffFile", () => {
  it("numbers added lines in the new version of the file", () => {
    const file = toDiffFile(
      "src/extension.ts",
      undefined,
      "@@ -1,3 +1,4 @@\n import a from 'a';\n-const x = 1;\n+const x = 2;\n+const y = 3;\n end();\n@@ -10,2 +11,2 @@ function f() {\n-old\n+new\n ctx",
    );
    expect([...file.added]).toEqual([
      [2, "const x = 2;"],
      [3, "const y = 3;"],
      [11, "new"],
    ]);
    expect(file.readable).toBe(true);
  });

  it("marks files without a patch, or with an inconsistent one, as unreadable", () => {
    expect(toDiffFile("icon.png", undefined, undefined)).toMatchObject({ readable: false, added: new Map() });
    expect(toDiffFile("a.ts", undefined, "@@ -1,1 +1,5 @@\n+only one")).toMatchObject({ readable: false });
  });
});
