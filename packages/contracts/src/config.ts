import { deepmergeCustom } from "deepmerge-ts";
import { z } from "zod";
import { CommitSha, GitHubLogin, RepoSlug, Slug, Usd } from "./ids.ts";
import { Harness, Mode, Platform } from "./mode.ts";

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
  review: Usd,
});
export type Budgets = z.infer<typeof Budgets>;

/**
 * A review's budget grows with the rules it checks: `baseUsd + perRuleUsd × rules`, at most
 * `budgets.review`. A flat budget is either too tight for a large pull request or too loose for a
 * small one.
 */
export const ReviewCost = z.strictObject({ baseUsd: Usd, perRuleUsd: Usd });
export type ReviewCost = z.infer<typeof ReviewCost>;

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

/**
 * A platform other than Linux a repository's runs can use. The environment and every other setting
 * stay the repository's: one environment action covers every platform (steps branch on `runner.os`).
 */
export const PlatformSettings = z.strictObject({ runsOn: z.string().min(1) });
export type PlatformSettings = z.infer<typeof PlatformSettings>;

const OtherPlatform = Platform.exclude(["linux"]);

/** Longest a run may take, in minutes. The controller derives how long run keys may live from it. */
export const MAX_TIMEOUT_MINUTES = 360;

/** Every setting a repo ends up with once global → project → repo are merged. */
export const RepoSettings = z.strictObject({
  harness: Harness,
  model: z.string().min(1),
  /** Per-mode overrides of `model`, e.g. a cheap model for `review`. */
  models: z.partialRecord(Mode, z.string().min(1)),
  /** The harness's small background model (Claude Code's "haiku" slot). Names follow the LLM backend. */
  fastModel: z.string().min(1),
  /** The Linux runner label. */
  runsOn: z.string().min(1),
  /** The other platforms runs may ask for (`@macaron-bot reproduce on windows`). */
  platforms: z.partialRecord(OtherPlatform, PlatformSettings).default({}),
  draftPr: z.boolean(),
  timeoutMinutes: z.int().min(5).max(MAX_TIMEOUT_MINUTES),
  /** USD per run, enforced by the run's LLM key. `review` is the ceiling of `reviewCost`. */
  budgets: Budgets,
  reviewCost: ReviewCost,
  caps: Caps,
  environment: Environment,
  commands: Commands,
  contribution: Contribution,
});
export type RepoSettings = z.infer<typeof RepoSettings>;

/** A partial override, as written at project or repo level. Objects merge, arrays and scalars replace. */
export const RepoSettingsPatch = z.strictObject({
  harness: Harness.optional(),
  model: z.string().min(1).optional(),
  models: z.partialRecord(Mode, z.string().min(1)).optional(),
  fastModel: z.string().min(1).optional(),
  runsOn: z.string().min(1).optional(),
  platforms: z.partialRecord(OtherPlatform, PlatformSettings.partial()).optional(),
  draftPr: z.boolean().optional(),
  timeoutMinutes: z.int().min(5).max(MAX_TIMEOUT_MINUTES).optional(),
  budgets: Budgets.partial().optional(),
  reviewCost: ReviewCost.partial().optional(),
  caps: Caps.partial().optional(),
  environment: EnvironmentPatch.optional(),
  commands: Commands.optional(),
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
  /**
   * Deprecated and ignored: who may trigger the bot is an account of the web app (invited, with its
   * capabilities). Still accepted so open-macaron/config's files parse until it drops them.
   */
  users: z.array(GitHubLogin).optional(),
  /** Review bots whose comments on the bot's pull requests count, for review loops only. */
  bots: z.array(GitHubLogin).default([]),
  budget: z.strictObject({ monthUsd: Usd }),
  concurrency: z.int().min(1).max(50),
  defaults: RepoSettingsPatch.default({}),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

/**
 * Name of the bot's fork of a repo: a random 6-character prefix and the upstream name
 * (`sf465s-podman-desktop`), so two upstreams with the same name never collide. Picked at
 * onboarding by the maintainer who creates the fork (REPOSITORIES.md §5); the owner is always
 * the bot account.
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
  bots: z.array(GitHubLogin),
});
export type RepoConfig = z.infer<typeof RepoConfig>;

/** Objects merge key by key; arrays and scalars are replaced (last value wins); undefined is ignored. */
const mergeSettings = deepmergeCustom({ mergeArrays: false });

/**
 * Applies one level of overrides. Switching the environment `source` starts that environment
 * from scratch, so parameters of a shared family never leak into an own/upstream environment.
 */
export function applySettingsPatch(base: RepoSettings, patch: RepoSettingsPatch): RepoSettings {
  const switchesSource = patch.environment?.source !== undefined && patch.environment.source !== base.environment.source;
  const seed = switchesSource ? { ...base, environment: { params: {} } } : base;
  return RepoSettings.parse(mergeSettings(seed, patch));
}

/** global → project → repo. Throws a ZodError naming the offending field if the result is invalid. */
export function resolveRepoConfig(global: GlobalFile, project: ProjectFile, repo: RepoFile): RepoConfig {
  const { repo: slug, fork, ...repoPatch } = repo;
  const settings = applySettingsPatch(applySettingsPatch(global.defaults, project.defaults), repoPatch);
  return RepoConfig.parse({ ...settings, repo: slug, fork, project: project.project, bots: project.bots });
}

/** The runner label for `platform`, or undefined when the repository doesn't enable it. */
export function runnerFor(config: Pick<RepoSettings, "runsOn" | "platforms">, platform: Platform): string | undefined {
  return platform === "linux" ? config.runsOn : config.platforms[platform]?.runsOn;
}

/** Every platform the repository's runs can use, Linux first. */
export function platformsOf(config: Pick<RepoSettings, "platforms">): Platform[] {
  return ["linux", ...Platform.options.filter((platform) => platform !== "linux" && config.platforms[platform] !== undefined)];
}

/** Every file the configuration is made of; anything else in a published snapshot is rejected. */
export const CONFIG_FILE_PATH = /^(?:global\.yaml|projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:project\.yaml|repos\/[A-Za-z0-9._-]{1,100}\.ya?ml))$/;

/**
 * The configuration as open-macaron/config publishes it on GitHub Pages (`v1/config.json`): its
 * files verbatim, at one commit. The controller validates them exactly as a local `config/` tree.
 */
export const PublishedConfig = z.strictObject({
  version: z.literal(1),
  commit: CommitSha,
  files: z.record(z.string().regex(CONFIG_FILE_PATH, "not a configuration file"), z.string().max(65_536)),
});
export type PublishedConfig = z.infer<typeof PublishedConfig>;
