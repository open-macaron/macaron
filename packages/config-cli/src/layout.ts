import type { OwnersLayout } from "@open-macaron/owners";

/**
 * open-macaron/config's layout: each `projects/<p>/` is owned by the owners in its `OWNERS.yaml`.
 * Everything else (`global.yaml`, the repository's own files, `.github/`) is the platform team's.
 */
const PROJECT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function folderOf(path: string): { readonly path: string } | undefined {
  const [top, project, ...rest] = path.split("/");
  if (top !== "projects" || project === undefined || rest.length === 0 || !PROJECT.test(project) || project.length > 64) return undefined;
  return { path: `projects/${project}` };
}

export const configLayout: OwnersLayout = { folderOf };

/** Files allowed outside the configuration itself, maintained by the platform team. */
export function isRepositoryFile(path: string): boolean {
  return path === "README.md" || path === "LICENSE" || path === ".gitignore" || path === ".editorconfig" || path.startsWith(".github/");
}
