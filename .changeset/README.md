# Changesets

Every package is versioned with [Changesets](https://changesets.dev). A pull request that changes a package adds a changeset with `pnpm changeset`: a small markdown file under this folder, naming the packages, the bump (patch, minor or major) and a summary for the changelog. A change with nothing to release says so with `pnpm changeset --empty`. CI (`changeset status`) fails a PR that changes a package without either.

On `main`, `release.yml` collects the changesets into one "Version Packages" pull request: it bumps the versions, writes each package's `CHANGELOG.md`, and bumps the packages that depend on a released one. That pull request merges itself once CI is green (auto-merge), and that merge is the release: a merged changeset ships within minutes. To hold a release, disable auto-merge on it.

- Every package is private: changesets tags each released version (`@open-macaron/<package>@<version>`) and writes its GitHub release. npm is untouched.
- `release.yml` then builds what was released: the controller image, the agent-cli, knowledge-cli and config-cli bundles, and `@open-macaron/review` on npm (once the repository variable `NPM_PUBLISH` is `true`).

See docs/DEPLOYMENT.md §1.
