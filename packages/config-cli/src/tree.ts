import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { CONFIG_FILE_PATH, ConfigTreeError, OwnersFile, parseConfigTree } from "@open-macaron/contracts";
import { parseYamlStrict, type Problem } from "@open-macaron/owners";
import { folderOf, isRepositoryFile } from "./layout.ts";

export interface ConfigRepository {
  /** The configuration's files, keyed by repository-relative path: what is published. */
  readonly files: ReadonlyMap<string, string>;
  /** Each project folder with its owners (undefined when its OWNERS.yaml is missing or invalid). */
  readonly folders: readonly { readonly path: string; readonly owners: OwnersFile | undefined }[];
  readonly problems: readonly Problem[];
}

/**
 * Loads open-macaron/config from `dir` and validates it: the configuration exactly as the
 * controller does (parseConfigTree), each project folder's OWNERS.yaml, and nothing else in the tree.
 */
export async function loadRepository(dir: string): Promise<ConfigRepository> {
  const problems: Problem[] = [];
  const files = new Map<string, string>();
  const owners = new Map<string, OwnersFile | undefined>();

  for (const path of await listFiles(dir)) {
    if (isRepositoryFile(path)) continue;
    const folder = folderOf(path);
    if (folder !== undefined && !owners.has(folder.path)) owners.set(folder.path, undefined);
    if (CONFIG_FILE_PATH.test(path)) {
      files.set(path, await readFile(join(dir, path), "utf8"));
    } else if (folder !== undefined && path === `${folder.path}/OWNERS.yaml`) {
      owners.set(folder.path, ownersFile(path, await readFile(join(dir, path), "utf8"), problems));
    } else {
      problems.push({ path, message: "not part of the configuration (global.yaml, projects/<p>/{OWNERS.yaml,project.yaml,repos/<r>.yaml})" });
    }
  }

  for (const [folder, file] of owners) {
    if (file === undefined && !problems.some((problem) => problem.path === `${folder}/OWNERS.yaml`)) {
      problems.push({ path: `${folder}/OWNERS.yaml`, message: "missing: every project folder needs owners" });
    }
  }

  try {
    parseConfigTree(files);
  } catch (error: unknown) {
    if (!(error instanceof ConfigTreeError)) throw error;
    for (const problem of error.problems) {
      const separator = problem.indexOf(": ");
      problems.push(separator < 0 ? { path: ".", message: problem } : { path: problem.slice(0, separator), message: problem.slice(separator + 2) });
    }
  }

  const folders = [...owners].sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => ({ path, owners: file }));
  return { files, folders, problems };
}

function ownersFile(path: string, source: string, problems: Problem[]): OwnersFile | undefined {
  let raw: unknown;
  try {
    raw = parseYamlStrict(source);
  } catch (error: unknown) {
    problems.push({ path, message: `not valid YAML: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
  const parsed = OwnersFile.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push({ path, message: `${issue.path.join(".") || "(root)"}: ${issue.message}` });
    return undefined;
  }
  return parsed.data;
}

/** Every file under `dir`, repository-relative with `/` separators, `.git` excluded. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => path !== ".git" && !path.startsWith(".git/"))
    .sort();
}
