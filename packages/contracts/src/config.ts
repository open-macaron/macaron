import { z } from "zod";
import { GitHubLogin, RepoSlug, Slug, Usd } from "./ids.ts";
import { Capability, Harness } from "./mode.ts";

const Params = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.string());

const UpstreamEnvPath = z
  .string()
  .regex(/^\.github\/macaron\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, "must live under .github/macaron/")
  .refine((path) => !path.split("/").includes(".."), "must not contain '..'");

/** Where a repo's environment composite action comes from (SCALING.md §1). */
export const Environment = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("shared"), name: Slug, params: Params }),
  z.strictObject({ source: z.literal("own"), params: Params }),
  z.strictObject({ source: z.literal("upstream"), path: UpstreamEnvPath, params: Params }),
]);
export type Environment = z.infer<typeof Environment>;

const EnvironmentPatch = z.strictObject({
  source: z.enum(["shared", "own", "upstream"]).optional(),
  name: Slug.optional(),
  path: UpstreamEnvPath.optional(),
  params: Params.optional(),
});

export const Budgets = z.strictObject({
  triage: Usd,
  plan: Usd,
  implement: Usd,
  address_review: Usd,
  reproduce: Usd,
  verify: Usd,
  retro: Usd,
});
export type Budgets = z.infer<typeof Budgets>;

export const Caps = z.strictObject({
  perThreadUsd: Usd,
  perRepoMonthUsd: Usd,
  reviewLoops: z.int().min(0).max(50),
  botReviewLoops: z.int().min(0).max(50),
  openPrs: z.int().min(1).max(50),
});
export type Caps = z.infer<typeof Caps>;

export const Commands = z.strictObject({
  build: z.string().min(1).optional(),
  test: z.string().min(1).optional(),
  lint: z.string().min(1).optional(),
});
export type Commands = z.infer<typeof Commands>;

export const Contribution = z.strictObject({
  dco: z.boolean(),
  cla: z.url().optional(),
  fixCi: z.boolean(),
});
export type Contribution = z.infer<typeof Contribution>;

/** Every setting a repo ends up with once global → project → repo are merged. */
export const RepoSettings = z.strictObject({
  harness: Harness,
  model: z.string().min(1),
  runsOn: z.string().min(1),
  draftPr: z.boolean(),
  timeoutMinutes: z.int().min(5).max(360),
  budgets: Budgets,
  caps: Caps,
  environment: Environment,
  commands: Commands,
  capabilities: z.array(Capability),
  contribution: Contribution,
});
export type RepoSettings = z.infer<typeof RepoSettings>;

/** A partial override, as written at project or repo level. Objects merge, arrays and scalars replace. */
export const RepoSettingsPatch = z.strictObject({
  harness: Harness.optional(),
  model: z.string().min(1).optional(),
  runsOn: z.string().min(1).optional(),
  draftPr: z.boolean().optional(),
  timeoutMinutes: z.int().min(5).max(360).optional(),
  budgets: Budgets.partial().optional(),
  caps: Caps.partial().optional(),
  environment: EnvironmentPatch.optional(),
  commands: Commands.optional(),
  capabilities: z.array(Capability).optional(),
  contribution: Contribution.partial().optional(),
});
export type RepoSettingsPatch = z.infer<typeof RepoSettingsPatch>;

/** `config/global.yaml` */
export const GlobalFile = z.strictObject({
  defaults: RepoSettings,
  routerModel: z.string().min(1),
  concurrency: z.strictObject({ global: z.int().min(1).max(100) }),
  platformTeam: z.string().regex(/^@[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/),
});
export type GlobalFile = z.infer<typeof GlobalFile>;

/** `config/projects/<project>/project.yaml` */
export const ProjectFile = z.strictObject({
  project: Slug,
  owners: z.string().regex(/^@[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/),
  users: z.array(GitHubLogin).min(1),
  bots: z.array(GitHubLogin).default([]),
  budget: z.strictObject({ monthUsd: Usd }),
  concurrency: z.int().min(1).max(50),
  defaults: RepoSettingsPatch.default({}),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

/**
 * Name of the bot's fork of a repo: a random 6-character prefix and the upstream name
 * (`sf465s-podman-desktop`), so two upstreams with the same name never collide. Chosen at
 * onboarding (`onboard-repo.sh` generates it); the owner is always the bot account.
 */
export const ForkName = z
  .string()
  .regex(/^[a-z0-9]{6}-[A-Za-z0-9._-]{1,93}$/, "expected <6 random lowercase chars>-<name>")
  .brand<"ForkName">();
export type ForkName = z.infer<typeof ForkName>;

/** `config/projects/<project>/repos/<name>.yaml` */
export const RepoFile = RepoSettingsPatch.extend({ repo: RepoSlug, fork: ForkName });
export type RepoFile = z.infer<typeof RepoFile>;

/** What the controller works with for one repository. */
export const RepoConfig = RepoSettings.extend({
  repo: RepoSlug,
  fork: ForkName,
  project: Slug,
  users: z.array(GitHubLogin),
  bots: z.array(GitHubLogin),
});
export type RepoConfig = z.infer<typeof RepoConfig>;

type PlainRecord = Readonly<Record<string, unknown>>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursive merge: plain objects merge key by key, everything else (arrays, scalars) is replaced. */
export function deepMerge(base: PlainRecord, patch: PlainRecord): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const previous = merged[key];
    merged[key] = isPlainRecord(previous) && isPlainRecord(value) ? deepMerge(previous, value) : value;
  }
  return merged;
}

/**
 * Applies one level of overrides. Switching the environment `source` starts that environment
 * from scratch, so parameters of a shared family never leak into an own/upstream environment.
 */
export function applySettingsPatch(base: RepoSettings, patch: RepoSettingsPatch): RepoSettings {
  const switchesSource = patch.environment?.source !== undefined && patch.environment.source !== base.environment.source;
  const seed: PlainRecord = switchesSource ? { ...base, environment: { params: {} } } : base;
  return RepoSettings.parse(deepMerge(seed, patch));
}

/** global → project → repo. Throws a ZodError naming the offending field if the result is invalid. */
export function resolveRepoConfig(global: GlobalFile, project: ProjectFile, repo: RepoFile): RepoConfig {
  const { repo: slug, fork, ...repoPatch } = repo;
  const settings = applySettingsPatch(applySettingsPatch(global.defaults, project.defaults), repoPatch);
  return RepoConfig.parse({ ...settings, repo: slug, fork, project: project.project, users: project.users, bots: project.bots });
}
