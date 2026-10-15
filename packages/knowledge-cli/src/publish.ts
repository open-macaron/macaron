import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type CommitSha, KnowledgeIndex, KnowledgeSlice, type PublishedLesson, type PublishedRule } from "@open-macaron/contracts";
import type { Folder, KnowledgeTree } from "./tree.ts";

/**
 * The GitHub Pages read API (DESIGN.md §6.5): one JSON file per folder, plus an index. Consumers
 * (the controller) merge global → project → repo themselves; they know which project a repo is in.
 */
export async function publish(tree: KnowledgeTree, commit: CommitSha, outDir: string): Promise<string[]> {
  const written: string[] = [];
  const write = async (path: string, value: unknown) => {
    const target = join(outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
    written.push(path);
  };

  const slices: KnowledgeIndex["slices"] = [];
  for (const folder of tree.folders) {
    const slice = KnowledgeSlice.parse(sliceOf(folder, commit));
    const path = slicePath(folder);
    await write(`v1/${path}`, slice);
    slices.push({
      scope: folder.scope,
      kind: folder.kind,
      path,
      rules: slice.rules.map(({ id, title, severity, appliesTo }) => ({ id, title, severity, appliesTo })),
      lessons: slice.lessons.map(({ id, topic }) => ({ id, topic })),
    });
  }
  await write("v1/index.json", KnowledgeIndex.parse({ version: 1, commit, slices }));
  // Serve files as they are: no Jekyll processing of the JSON tree.
  await writeFile(join(outDir, ".nojekyll"), "");
  return written;
}

function slicePath(folder: Folder): string {
  switch (folder.kind) {
    case "global":
      return "global.json";
    case "project":
      return `projects/${folder.scope}.json`;
    case "repo":
      return `repos/${folder.scope}.json`;
  }
}

function sliceOf(folder: Folder, commit: CommitSha): KnowledgeSlice {
  const rules: PublishedRule[] = folder.rules.map((rule) => ({
    id: rule.id,
    scope: folder.scope,
    title: rule.frontMatter.title,
    severity: rule.frontMatter.severity,
    appliesTo: rule.frontMatter.applies_to ?? null,
    exclude: rule.frontMatter.exclude,
    sources: rule.frontMatter.sources,
    body: rule.body,
  }));
  const lessons: PublishedLesson[] = folder.lessons.map((lesson) => ({
    id: lesson.id,
    scope: folder.scope,
    topic: lesson.frontMatter.topic,
    appliesTo: lesson.frontMatter.applies_to ?? null,
    sources: lesson.frontMatter.sources,
    lastVerified: lesson.frontMatter.last_verified,
    confidence: lesson.frontMatter.confidence,
    body: lesson.body,
  }));
  return { version: 1, commit, scope: folder.scope, overview: folder.overview, rules, lessons };
}
