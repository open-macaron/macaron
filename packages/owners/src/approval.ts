import type { OwnersFile } from "@open-macaron/contracts";
import type { OwnersLayout } from "./layout.ts";

/**
 * Whether a PR may be merged (DESIGN.md §6.4). Pure: every input comes from GitHub's API or from
 * `main`, never from the event that woke the workflow up. Only `platformPaths` may be derived from
 * the PR's content, and it can only keep a PR from merging, never make it mergeable.
 */

export interface ChangedFile {
  readonly path: string;
  /** Set for renames: the old path is touched too. */
  readonly previousPath?: string | undefined;
}

export interface Review {
  readonly userId: number;
  readonly login: string;
  /** GitHub's review state: APPROVED, CHANGES_REQUESTED, DISMISSED, COMMENTED, PENDING. */
  readonly state: string;
  /** The commit the review was submitted on. */
  readonly commitId: string | null;
}

export interface ApprovalInput {
  readonly headSha: string;
  readonly authorId: number;
  readonly files: readonly ChangedFile[];
  /** In submission order, as the API lists them. */
  readonly reviews: readonly Review[];
  /** `OWNERS.yaml` of each touched folder, read from the default branch; undefined when absent or invalid there. */
  readonly ownersOnMain: ReadonlyMap<string, OwnersFile | undefined>;
  /** The format check of this exact head, by the CLI pinned on the default branch. */
  readonly formatValid: boolean;
  /** Paths the repository reserves for the platform team whatever their folder (e.g. who may trigger the bot). */
  readonly platformPaths?: readonly string[];
}

export type FolderStatus =
  | { readonly folder: string; readonly state: "approved"; readonly by: readonly string[] }
  | { readonly folder: string; readonly state: "changes_requested"; readonly by: readonly string[] }
  | { readonly folder: string; readonly state: "waiting"; readonly owners: readonly string[] };

export interface Decision {
  readonly ready: boolean;
  readonly formatValid: boolean;
  readonly folders: readonly FolderStatus[];
  /** Files outside any owned folder that exists on the default branch: only the platform team merges those. */
  readonly unownedFiles: number;
  /** Files whose change the repository reserves for the platform team: it merges those by hand too. */
  readonly platformFiles: number;
}

/** Owned folders a PR touches, and how many of its paths fall outside them. */
export function touchedFolders(files: readonly ChangedFile[], layout: OwnersLayout): { readonly folders: readonly string[]; readonly outside: number } {
  const folders = new Set<string>();
  let outside = 0;
  for (const file of files) {
    for (const path of file.previousPath === undefined ? [file.path] : [file.path, file.previousPath]) {
      const folder = layout.folderOf(path);
      if (folder === undefined) outside++;
      else folders.add(folder.path);
    }
  }
  return { folders: [...folders].sort(), outside };
}

/** Each reviewer's standing review: the latest that approves, requests changes or was dismissed. Comments don't change it. */
function standingReviews(reviews: readonly Review[]): Map<number, Review> {
  const standing = new Map<number, Review>();
  for (const review of reviews) {
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED" || review.state === "DISMISSED") standing.set(review.userId, review);
  }
  return standing;
}

export function decide(input: ApprovalInput, layout: OwnersLayout): Decision {
  const { folders, outside } = touchedFolders(input.files, layout);
  const standing = [...standingReviews(input.reviews).values()].filter((review) => review.userId !== input.authorId);

  let unownedFiles = outside;
  const statuses: FolderStatus[] = [];
  for (const folder of folders) {
    const owners = input.ownersOnMain.get(folder);
    if (owners === undefined) {
      // A new folder, or one whose OWNERS.yaml on main is broken: the platform team decides.
      unownedFiles += input.files.filter(
        (file) => layout.folderOf(file.path)?.path === folder || (file.previousPath !== undefined && layout.folderOf(file.previousPath)?.path === folder),
      ).length;
      continue;
    }
    const ownerIds = new Set(owners.owners.map((owner) => owner.id));
    const byOwners = standing.filter((review) => ownerIds.has(review.userId));
    const blocking = byOwners.filter((review) => review.state === "CHANGES_REQUESTED");
    const approving = byOwners.filter((review) => review.state === "APPROVED" && review.commitId === input.headSha);
    if (blocking.length > 0) statuses.push({ folder, state: "changes_requested", by: blocking.map((review) => review.login) });
    else if (approving.length > 0) statuses.push({ folder, state: "approved", by: approving.map((review) => review.login) });
    else statuses.push({ folder, state: "waiting", owners: owners.owners.map((owner) => owner.login) });
  }

  const platformFiles = new Set(input.platformPaths ?? []).size;
  const ready =
    input.formatValid && unownedFiles === 0 && platformFiles === 0 && statuses.length > 0 && statuses.every((status) => status.state === "approved");
  return { ready, formatValid: input.formatValid, folders: statuses, unownedFiles, platformFiles };
}
