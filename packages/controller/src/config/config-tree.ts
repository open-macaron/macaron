import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  GlobalFile,
  ProjectFile,
  type RepoConfig,
  RepoFile,
  type RepoSlug,
  resolveRepoConfig,
} from "@open-macaron/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface ConfigSnapshot {
  readonly global: GlobalFile;
  readonly projects: ReadonlyMap<string, ProjectFile>;
  /** Keyed by lower-cased `owner/name`: GitHub repository names are case-insensitive. */
  readonly repos: ReadonlyMap<string, RepoConfig>;
}

export class ConfigTreeError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigTreeError";
  }
}

export function repoKey(repo: RepoSlug | string): string {
  return repo.toLowerCase();
}

/**
 * Loads and validates `<dir>/global.yaml`, `<dir>/projects/<p>/project.yaml` and
 * `<dir>/projects/<p>/repos/*.yaml`. Collects every problem before failing, with file paths.
 */
export async function loadConfigTree(dir: string): Promise<ConfigSnapshot> {
  const problems: string[] = [];
  const where = (file: string) => relative(dir, file);

  async function readFileAs<T>(file: string, schema: z.ZodType<T>): Promise<T | undefined> {
    let raw: unknown;
    try {
      raw = parseYaml(await readFile(file, "utf8"), { strict: true, uniqueKeys: true });
    } catch (error: unknown) {
      problems.push(`${where(file)}: ${error instanceof Error ? error.message : "unreadable"}`);
      return undefined;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) problems.push(`${where(file)}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      return undefined;
    }
    return result.data;
  }

  const global = await readFileAs(join(dir, "global.yaml"), GlobalFile);
  const projects = new Map<string, ProjectFile>();
  const repos = new Map<string, RepoConfig>();

  const projectsDir = join(dir, "projects");
  for (const entry of await readdir(projectsDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const projectFile = join(projectsDir, entry.name, "project.yaml");
    const project = await readFileAs(projectFile, ProjectFile);
    if (project === undefined) continue;
    if (project.project !== entry.name) {
      problems.push(`${where(projectFile)}: project "${project.project}" must live in projects/${project.project}/`);
      continue;
    }
    projects.set(project.project, project);

    const reposDir = join(projectsDir, entry.name, "repos");
    for (const repoEntry of await readdir(reposDir, { withFileTypes: true }).catch(() => [])) {
      if (!repoEntry.isFile() || !/\.ya?ml$/.test(repoEntry.name)) continue;
      const repoFile = join(reposDir, repoEntry.name);
      const repo = await readFileAs(repoFile, RepoFile);
      if (repo === undefined || global === undefined) continue;
      const key = repoKey(repo.repo);
      const owner = repos.get(key);
      if (owner !== undefined) {
        problems.push(`${where(repoFile)}: ${repo.repo} is already configured by project "${owner.project}"`);
        continue;
      }
      try {
        repos.set(key, resolveRepoConfig(global, project, repo));
      } catch (error: unknown) {
        const detail =
          error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : String(error);
        problems.push(`${where(repoFile)}: after merging defaults: ${detail}`);
      }
    }
  }

  if (global === undefined || problems.length > 0) throw new ConfigTreeError(problems);
  return { global, projects, repos };
}
