/** Where a repository's owned folders are: each holds an `OWNERS.yaml` whose owners approve changes inside it. */
export interface OwnersLayout {
  /** The owned folder `path` belongs to, or undefined (root files, `.github/`, anything the platform team keeps). */
  folderOf(path: string): { readonly path: string } | undefined;
}
