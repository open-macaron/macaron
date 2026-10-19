import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { LessonFrontMatter, OwnersFile, RULE_SECTIONS, RuleFrontMatter } from "@open-macaron/contracts";
import picomatch from "picomatch";
import type { z } from "zod";
import { parseDocument, parseYamlStrict } from "./document.ts";
import { entryOf, folderOf, isRepositoryFile, type OwnedFolder } from "./layout.ts";

/** Knowledge files are short by design; anything larger is a mistake or an attack on the reviewer. */
const MAX_FILE_BYTES = 64 * 1024;

export interface Problem {
  readonly path: string;
  readonly message: string;
}

export interface Rule {
  readonly id: string;
  readonly path: string;
  readonly frontMatter: RuleFrontMatter;
  readonly body: string;
}

export interface Lesson {
  readonly id: string;
  readonly path: string;
  readonly frontMatter: LessonFrontMatter;
  readonly body: string;
}

export interface Folder extends OwnedFolder {
  owners: OwnersFile | undefined;
  overview: string | null;
  readonly rules: Rule[];
  readonly lessons: Lesson[];
}

export interface KnowledgeTree {
  readonly folders: readonly Folder[];
  readonly problems: readonly Problem[];
}

/** Reads and validates the whole repository checked out at `root`. Never executes anything from it. */
export async function loadTree(root: string): Promise<KnowledgeTree> {
  const problems: Problem[] = [];
  const folders = new Map<string, Folder>();

  for (const path of await listFiles(root, problems)) {
    if (isRepositoryFile(path)) continue;
    const owned = folderOf(path);
    const entry = owned === undefined ? undefined : entryOf(owned, path.slice(owned.path.length + 1));
    if (owned === undefined || entry === undefined) {
      problems.push({ path, message: "unexpected file: see README.md for the layout" });
      continue;
    }
    const folder = folders.get(owned.path) ?? { ...owned, owners: undefined, overview: null, rules: [], lessons: [] };
    folders.set(owned.path, folder);

    const source = await readSmallFile(root, path, problems);
    if (source === undefined) continue;
    switch (entry.kind) {
      case "owners": {
        const owners = validate(OwnersFile, parseYaml(source, path, problems), path, problems);
        if (owners !== undefined) folder.owners = owners;
        break;
      }
      case "overview":
        folder.overview = source.trim();
        break;
      case "rule": {
        const rule = readRule(source, `${owned.scope}/${entry.name}`, path, problems);
        if (rule !== undefined) folder.rules.push(rule);
        break;
      }
      case "lesson": {
        const lesson = readLesson(source, `${owned.scope}/lessons/${entry.slug}`, path, problems);
        if (lesson !== undefined) folder.lessons.push(lesson);
        break;
      }
    }
  }

  for (const folder of folders.values()) {
    if (folder.owners === undefined && !problems.some((problem) => problem.path === `${folder.path}/OWNERS.yaml`)) {
      problems.push({ path: `${folder.path}/OWNERS.yaml`, message: "every folder needs an OWNERS.yaml: who approves changes to it" });
    }
  }
  const sorted = [...folders.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { folders: sorted, problems };
}

function readRule(source: string, id: string, path: string, problems: Problem[]): Rule | undefined {
  const parsed = parseDocument(source);
  if (!parsed.ok) {
    problems.push({ path, message: parsed.error });
    return undefined;
  }
  const frontMatter = validate(RuleFrontMatter, parsed.document.frontMatter, path, problems);
  const sections = parsed.document.headings.filter((heading) => heading.depth === 2).map((heading) => heading.text);
  if (sections.join("\n") !== RULE_SECTIONS.join("\n")) {
    problems.push({
      path,
      message: `a rule has exactly these "##" sections, in order: ${RULE_SECTIONS.join(", ")} (found: ${sections.length === 0 ? "none" : sections.join(", ")})`,
    });
    return undefined;
  }
  if (frontMatter === undefined || !globsCompile([...(frontMatter.applies_to ?? []), ...frontMatter.exclude], path, problems)) return undefined;
  return { id, path, frontMatter, body: parsed.document.body };
}

function readLesson(source: string, id: string, path: string, problems: Problem[]): Lesson | undefined {
  const parsed = parseDocument(source);
  if (!parsed.ok) {
    problems.push({ path, message: parsed.error });
    return undefined;
  }
  const frontMatter = validate(LessonFrontMatter, parsed.document.frontMatter, path, problems);
  if (frontMatter === undefined || !globsCompile(frontMatter.applies_to ?? [], path, problems)) return undefined;
  if (parsed.document.body.length === 0) {
    problems.push({ path, message: "a lesson needs a body" });
    return undefined;
  }
  return { id, path, frontMatter, body: parsed.document.body };
}

function globsCompile(globs: readonly string[], path: string, problems: Problem[]): boolean {
  for (const glob of globs) {
    try {
      picomatch.makeRe(glob, { strictBrackets: true });
    } catch (error: unknown) {
      problems.push({ path, message: `invalid glob ${JSON.stringify(glob)}: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }
  return true;
}

function validate<T>(schema: z.ZodType<T>, value: unknown, path: string, problems: Problem[]): T | undefined {
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    problems.push({ path, message: `${issue.path.length === 0 ? "" : `${issue.path.join(".")}: `}${issue.message}` });
  }
  return undefined;
}

function parseYaml(source: string, path: string, problems: Problem[]): unknown {
  try {
    return parseYamlStrict(source);
  } catch (error: unknown) {
    problems.push({ path, message: `not valid YAML: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
}

async function readSmallFile(root: string, path: string, problems: Problem[]): Promise<string | undefined> {
  const buffer = await readFile(join(root, path));
  if (buffer.length > MAX_FILE_BYTES) {
    problems.push({ path, message: `larger than ${String(MAX_FILE_BYTES / 1024)} KiB` });
    return undefined;
  }
  return buffer.toString("utf8");
}

/** Every regular file under `root` (repository-relative, `/`-separated), skipping `.git`. Dirents don't follow symlinks; those are refused. */
async function listFiles(root: string, problems: Problem[]): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join("/");
    if (path === ".git" || path.startsWith(".git/")) continue;
    if (entry.isSymbolicLink()) {
      problems.push({ path, message: "symbolic links are not allowed" });
      continue;
    }
    if (entry.isFile()) files.push(path);
    else if (!entry.isDirectory()) problems.push({ path, message: "not a regular file" });
  }
  return files.sort();
}
