/**
 * The repository's layout (DESIGN.md §6.1), as pure functions over repository-relative paths.
 * Shared by validation (what may exist) and approval (which folder's owners a file belongs to).
 */

/** A folder with its own `OWNERS.yaml`: `global`, `projects/<p>` or `repos/<o>/<r>`. */
export interface OwnedFolder {
  readonly kind: "global" | "project" | "repo";
  /** Repository-relative path, e.g. `projects/sandbox`. */
  readonly path: string;
  /** What rule ids start with: `global`, `<p>` or `<o>/<r>`. */
  readonly scope: string;
}

const PROJECT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** The owned folder a path belongs to, or undefined (root files, `.github/`, malformed paths). */
export function folderOf(path: string): OwnedFolder | undefined {
  const parts = path.split("/");
  const [top, a, b] = parts;
  if (top === "global" && parts.length >= 2) return { kind: "global", path: "global", scope: "global" };
  if (top === "projects" && a !== undefined && parts.length >= 3 && PROJECT.test(a) && a !== "global") {
    return { kind: "project", path: `projects/${a}`, scope: a };
  }
  if (top === "repos" && a !== undefined && b !== undefined && parts.length >= 4 && OWNER.test(a) && REPO.test(b) && b !== "." && b !== "..") {
    return { kind: "repo", path: `repos/${a}/${b}`, scope: `${a}/${b}` };
  }
  return undefined;
}

/** What a file inside an owned folder is. */
export type Entry =
  | { readonly kind: "owners" }
  | { readonly kind: "overview" }
  /** `<slug>`, or `<category>/<slug>` for a rule filed under `rules/<category>/` (ESLint-style ids). */
  | { readonly kind: "rule"; readonly name: string }
  | { readonly kind: "lesson"; readonly slug: string };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isSlug = (value: string | undefined): value is string => value !== undefined && SLUG.test(value) && value.length <= 64;

/** Classifies `rest`, a path relative to its owned folder. Undefined: not allowed there. */
export function entryOf(folder: OwnedFolder, rest: string): Entry | undefined {
  if (rest === "OWNERS.yaml") return { kind: "owners" };
  if (rest === "overview.md" && folder.kind === "repo") return { kind: "overview" };
  const lesson = /^lessons\/([^/]+)\.md$/.exec(rest)?.[1];
  if (lesson !== undefined) return isSlug(lesson) ? { kind: "lesson", slug: lesson } : undefined;
  const [, category, slug] = /^rules\/(?:([^/]+)\/)?([^/]+)\.md$/.exec(rest) ?? [];
  if (!isSlug(slug)) return undefined;
  if (category === undefined) return { kind: "rule", name: slug };
  // `<scope>/lessons/<slug>` is a lesson's id: a `lessons` category would collide with it.
  return isSlug(category) && category !== "lessons" ? { kind: "rule", name: `${category}/${slug}` } : undefined;
}

/** Files allowed outside owned folders (maintained by the platform team). */
export function isRepositoryFile(path: string): boolean {
  return path === "README.md" || path === "LICENSE" || path === ".gitignore" || path === ".editorconfig" || path.startsWith(".github/");
}
