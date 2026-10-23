import type { ConfigSnapshot } from "@open-macaron/contracts";

/** Every model a configuration can give a run. */
export function configuredModels(snapshot: ConfigSnapshot): string[] {
  return [...new Set([...snapshot.repos.values()].flatMap((repo) => [repo.model, repo.fastModel, ...Object.values(repo.models)]))];
}
