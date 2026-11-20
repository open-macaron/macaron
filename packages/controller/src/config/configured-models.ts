import { type ConfigSnapshot, fallbackSettings, type RepoSettings } from "@open-macaron/contracts";

/** Injects `() => configuredModels(<the live configuration>)`. */
export const CONFIGURED_MODELS = Symbol("CONFIGURED_MODELS");

/** Every model a configuration can give a run: its listed repositories' and its fallbacks'. */
export function configuredModels(snapshot: ConfigSnapshot): string[] {
  const fallbacks = [...snapshot.orgs.values()].flatMap((org) => fallbackSettings(snapshot.global, org) ?? []);
  const settings: readonly RepoSettings[] = [...snapshot.repos.values(), ...fallbacks];
  return [...new Set(settings.flatMap((repo) => [repo.model, repo.fastModel]))];
}
