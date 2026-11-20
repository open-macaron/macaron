import { deepmergeCustom } from "deepmerge-ts";
import { z } from "zod";
import { CommitSha, GitHubLogin, RepoSlug, Slug, Usd } from "./ids.ts";
import { Harness, Platform } from "./mode.ts";

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

/** Every setting a repo ends up with once global → org → repo are merged. */
export const RepoSettings = z.strictObject({
  harness: Harness,
  model: z.string().min(1),
  /** The harness's small background model (Claude Code's "haiku" slot). Names follow the LLM backend. */
  fastModel: z.string().min(1),
  /** The Linux runner label. */
  runsOn: z.string().min(1),
  /** The other platforms runs may ask for (`@macaron-bot reproduce on windows`). */
  platforms: z.partialRecord(OtherPlatform, PlatformSettings).default({}),
  draftPr: z.boolean(),
  /**
   * No status comment while a run works: 👀 says it started, and the answer carries the run, the
   * runner and the cost in a footer. Fewer notifications; failures are posted either way.
   */
  compact: z.boolean().default(true),
  timeoutMinutes: z.int().min(5).max(MAX_TIMEOUT_MINUTES),
  /** USD per run, enforced by the run's LLM key. `review` is the ceiling of `reviewCost`. */
  budgets: Budgets,
  reviewCost: ReviewCost,
  caps: Caps,
  environment: Environment,
  commands: Commands,
  contribution: Contribution,
  /** The open-macaron/knowledge folder (`projects/<knowledge>`) whose rules and lessons apply; the org's login when unset. */
  knowledge: Slug.optional(),
});
export type RepoSettings = z.infer<typeof RepoSettings>;

/** A partial override, as written in an org's defaults, a repository entry or the fallback. Objects merge, arrays and scalars replace. */
export const RepoSettingsPatch = z.strictObject({
  harness: Harness.optional(),
  model: z.string().min(1).optional(),
  fastModel: z.string().min(1).optional(),
  runsOn: z.string().min(1).optional(),
  platforms: z.partialRecord(OtherPlatform, PlatformSettings.partial()).optional(),
  draftPr: z.boolean().optional(),
  compact: z.boolean().optional(),
  timeoutMinutes: z.int().min(5).max(MAX_TIMEOUT_MINUTES).optional(),
  budgets: Budgets.partial().optional(),
  reviewCost: ReviewCost.partial().optional(),
  caps: Caps.partial().optional(),
  environment: EnvironmentPatch.optional(),
  commands: Commands.optional(),
  contribution: Contribution.partial().optional(),
  knowledge: Slug.optional(),
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

const TeamRef = z.string().regex(/^@[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/);

/** A repository's name within its owner, as GitHub allows it. */
export const RepoName = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, "not a repository name");

/**
 * `config/orgs/<org>/org.yaml`: a GitHub owner (an organisation or a user) and its repositories.
 * `id` is the owner's account id: the controller follows a rename by it, `org` is only its login
 * when the file was written. Without a `fallback`, the bot works on the listed repositories only.
 * There is no org budget: every run is billed to its payer's own key, under their monthly cap.
 */
export const OrgFile = z.strictObject({
  org: GitHubLogin,
  id: z.int().positive(),
  owners: TeamRef,
  /** Review bots whose comments on the bot's pull requests count, for review loops only. */
  bots: z.array(GitHubLogin).default([]),
  concurrency: z.int().min(1).max(50),
  defaults: RepoSettingsPatch.default({}),
  repos: z.record(RepoName, RepoSettingsPatch).default({}),
  /** What the repositories it doesn't list get: any repository setting. */
  fallback: z.union([z.literal(false), RepoSettingsPatch]).default(false),
});
export type OrgFile = z.infer<typeof OrgFile>;

/** What the controller works with for one repository. */
export const RepoConfig = RepoSettings.extend({
  repo: RepoSlug,
  /** The org file's login, which the ledger and budgets are keyed by. */
  org: GitHubLogin,
  orgId: z.int().positive(),
  knowledge: Slug,
  bots: z.array(GitHubLogin),
  /** Not listed in its org's `repos`: configured by its `fallback`. */
  fallback: z.boolean(),
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

/** The org's own settings for `name`: listed, else its fallback's, else undefined. Throws a ZodError naming the offending field if the merge is invalid. */
export function repoSettingsOf(global: GlobalFile, org: OrgFile, name: string): { settings: RepoSettings; fallback: boolean } | undefined {
  const base = applySettingsPatch(global.defaults, org.defaults);
  const listed = Object.entries(org.repos).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase());
  if (listed !== undefined) return { settings: applySettingsPatch(base, listed[1]), fallback: false };
  if (org.fallback === false) return undefined;
  return { settings: applySettingsPatch(base, org.fallback), fallback: true };
}

/** What the org's fallback gives every repository it doesn't list; undefined without a fallback. */
export function fallbackSettings(global: GlobalFile, org: OrgFile): RepoSettings | undefined {
  return repoSettingsOf(global, { ...org, repos: {} }, "")?.settings;
}

/**
 * global → org defaults → the org's entry for the repository, or its fallback. `repo` keeps the
 * caller's owner login, which follows a rename of the org. Undefined when the org doesn't take it.
 */
export function resolveRepoConfig(global: GlobalFile, org: OrgFile, repo: RepoSlug): RepoConfig | undefined {
  const name = repo.slice(repo.indexOf("/") + 1);
  const resolved = repoSettingsOf(global, org, name);
  if (resolved === undefined) return undefined;
  return RepoConfig.parse({ ...resolved.settings, repo, org: org.org, orgId: org.id, knowledge: resolved.settings.knowledge ?? org.org.toLowerCase(), bots: org.bots, fallback: resolved.fallback });
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
export const CONFIG_FILE_PATH = /^(?:global\.yaml|orgs\/[A-Za-z0-9-]{1,39}\/org\.yaml)$/;

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
