export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

/** `owner/name` → `{ owner, repo }`, the shape Octokit expects. */
export function repoRef(fullName: string): RepoRef {
  const [owner, repo, ...rest] = fullName.split("/");
  if (owner === undefined || repo === undefined || rest.length > 0 || owner === "" || repo === "") {
    throw new Error(`not an owner/name repository: ${fullName}`);
  }
  return { owner, repo };
}

export function fullName(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/** HTTP status of an Octokit RequestError (or undefined for anything else). */
export function httpStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
}
