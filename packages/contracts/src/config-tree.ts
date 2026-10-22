import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE_PATH, GlobalFile, ProjectFile, type RepoConfig, RepoFile, resolveRepoConfig } from "./config.ts";
import type { RepoSlug } from "./ids.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface ConfigSnapshot {
  readonly global: GlobalFile;
  readonly projects: ReadonlyMap<string, ProjectFile>;
  /** Keyed by lower-cased `owner/name`: GitHub repository names are case-insensitive. */
  readonly repos: ReadonlyMap<string, RepoConfig>;
}

export class ConfigTreeError extends Error {
  // A plain field, not a parameter property: contracts' sources also run under Node's type stripping (gen).
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigTreeError";
    this.problems = problems;
  }
}

export function repoKey(repo: RepoSlug | string): string {
  return repo.toLowerCase();
}

const PROJECT_FILE = /^projects\/([^/]+)\/project\.yaml$/;
const REPO_FILE = /^projects\/([^/]+)\/repos\/[^/]+\.ya?ml$/;

/**
 * Validates a configuration given as its files (repository-relative path → content): `global.yaml`,
 * `projects/<p>/project.yaml` and `projects/<p>/repos/*.yaml`. The single validation path, for a
 * local `config/` tree and a published snapshot alike. Collects every problem, with its path, before failing.
 */
export function parseConfigTree(files: ReadonlyMap<string, string>): ConfigSnapshot {
  const problems: string[] = [];
  // Sorted: which of two projects claiming the same repository is reported doesn't depend on the source.
  const paths = [...files.keys()].sort();

  function parseAs<T>(path: string, schema: z.ZodType<T>): T | undefined {
    const content = files.get(path);
    if (content === undefined) {
      problems.push(`${path}: missing`);
      return undefined;
    }
    let raw: unknown;
    try {
      raw = parseYaml(content, { strict: true, uniqueKeys: true });
    } catch (error: unknown) {
      problems.push(`${path}: ${error instanceof Error ? error.message : "unreadable"}`);
      return undefined;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) problems.push(`${path}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      return undefined;
    }
    return result.data;
  }

  for (const path of paths) {
    if (!CONFIG_FILE_PATH.test(path)) problems.push(`${path}: not a configuration file (global.yaml, projects/<p>/project.yaml, projects/<p>/repos/<r>.yaml)`);
  }

  const global = parseAs("global.yaml", GlobalFile);
  const projects = new Map<string, ProjectFile>();
  const repos = new Map<string, RepoConfig>();

  const folders = new Set(paths.flatMap((path) => PROJECT_FILE.exec(path)?.[1] ?? REPO_FILE.exec(path)?.[1] ?? []));
  for (const folder of [...folders].sort()) {
    const projectFile = `projects/${folder}/project.yaml`;
    const project = parseAs(projectFile, ProjectFile);
    if (project === undefined) continue;
    if (project.project !== folder) {
      problems.push(`${projectFile}: project "${project.project}" must live in projects/${project.project}/`);
      continue;
    }
    projects.set(project.project, project);

    for (const repoFile of paths.filter((path) => REPO_FILE.exec(path)?.[1] === folder)) {
      const repo = parseAs(repoFile, RepoFile);
      if (repo === undefined || global === undefined) continue;
      const key = repoKey(repo.repo);
      const owner = repos.get(key);
      if (owner !== undefined) {
        problems.push(`${repoFile}: ${repo.repo} is already configured by project "${owner.project}"`);
        continue;
      }
      try {
        repos.set(key, resolveRepoConfig(global, project, repo));
      } catch (error: unknown) {
        const detail =
          error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : String(error);
        problems.push(`${repoFile}: after merging defaults: ${detail}`);
      }
    }
  }

  if (global === undefined || problems.length > 0) throw new ConfigTreeError(problems);
  return { global, projects, repos };
}

/** Reads a local `config/` tree (only the files the layout defines), then validates it with {@link parseConfigTree}. */
export async function loadConfigTree(dir: string): Promise<ConfigSnapshot> {
  return parseConfigTree(await readConfigFiles(dir));
}

/** The configuration files of a local tree, keyed by path relative to `dir`. */
export async function readConfigFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const add = async (path: string): Promise<void> => {
    const content = await readFile(join(dir, path), "utf8").catch(() => undefined);
    if (content !== undefined) files.set(path, content);
  };
  await add("global.yaml");
  for (const project of await readdir(join(dir, "projects"), { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue;
    await add(`projects/${project.name}/project.yaml`);
    for (const repo of await readdir(join(dir, "projects", project.name, "repos"), { withFileTypes: true }).catch(() => [])) {
      if (repo.isFile() && /\.ya?ml$/.test(repo.name)) await add(`projects/${project.name}/repos/${repo.name}`);
    }
  }
  return files;
}
