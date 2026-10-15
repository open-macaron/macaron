import { z } from "zod";
import { CommitSha, GitHubLogin } from "./ids.ts";

/**
 * open-macaron/knowledge (DESIGN.md §6): the files humans and the bot write, and the JSON that
 * GitHub Pages serves from them. Front matter keys are snake_case (written by people); the
 * published JSON is camelCase.
 */

/** A path pattern relative to the upstream repository's root, matched with picomatch. */
export const Glob = z
  .string()
  .min(1)
  .max(200)
  .refine((glob) => !glob.startsWith("/") && !glob.includes("\\") && !glob.split("/").includes(".."), "expected a relative glob without `..` or backslashes");

/** File name of a rule or lesson, without `.md`. */
export const KnowledgeSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected kebab-case").max(64);

const HttpsUrl = z.url({ protocol: /^https$/ });

/** `<folder>/OWNERS.yaml`. Owners are matched by id: a login can be renamed and re-registered. */
export const OwnersFile = z.strictObject({
  owners: z
    .array(
      z.strictObject({
        /** Shown and @mentioned; `check` verifies it still resolves to `id`. */
        login: GitHubLogin,
        /** What approvals are matched on. */
        id: z.int().positive(),
      }),
    )
    .min(1)
    .refine((owners) => new Set(owners.map((owner) => owner.id)).size === owners.length, "an owner is listed twice"),
});
export type OwnersFile = z.infer<typeof OwnersFile>;

export const RuleSeverity = z.enum(["error", "warning"]);
export type RuleSeverity = z.infer<typeof RuleSeverity>;

/** Front matter of `rules/<slug>.md`. */
export const RuleFrontMatter = z.strictObject({
  title: z.string().min(1).max(120),
  /** error → ❌ violation in reviews; warning → ⚠️ warning. */
  severity: RuleSeverity,
  /** Files the rule applies to. Omitted: every file. */
  applies_to: z.array(Glob).min(1).optional(),
  exclude: z.array(Glob).default([]),
  /** Where the rule comes from: review comments, documentation. */
  sources: z.array(HttpsUrl).default([]),
});
export type RuleFrontMatter = z.infer<typeof RuleFrontMatter>;

/** The level-2 headings every rule has, in this order: what the reviewing model is given. */
export const RULE_SECTIONS = ["Check", "Violation", "Not a violation", "Examples"] as const;

/** Front matter of `lessons/<slug>.md`. */
export const LessonFrontMatter = z.strictObject({
  topic: z.string().min(1).max(120),
  applies_to: z.array(Glob).min(1).optional(),
  /** Evidence: a lesson without a source can't be reviewed. */
  sources: z.array(HttpsUrl).min(1),
  last_verified: z.iso.date(),
  confidence: z.enum(["low", "medium", "high"]),
});
export type LessonFrontMatter = z.infer<typeof LessonFrontMatter>;

/** `global`, a project name, or `<owner>/<repo>`: the folder a rule or lesson lives in. */
export const KnowledgeScope = z.string().regex(/^(global|[a-z0-9]+(-[a-z0-9]+)*|[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})$/);

export const PublishedRule = z.strictObject({
  /** `<scope>/<slug>`: stable, cited by review tables, never reused. */
  id: z.string().min(1),
  scope: KnowledgeScope,
  title: z.string(),
  severity: RuleSeverity,
  appliesTo: z.array(Glob).nullable(),
  exclude: z.array(Glob),
  sources: z.array(HttpsUrl),
  /** The Markdown after the front matter: the four sections. */
  body: z.string(),
});
export type PublishedRule = z.infer<typeof PublishedRule>;

export const PublishedLesson = z.strictObject({
  id: z.string().min(1),
  scope: KnowledgeScope,
  topic: z.string(),
  appliesTo: z.array(Glob).nullable(),
  sources: z.array(HttpsUrl),
  lastVerified: z.iso.date(),
  confidence: LessonFrontMatter.shape.confidence,
  body: z.string(),
});
export type PublishedLesson = z.infer<typeof PublishedLesson>;

/** `v1/global.json`, `v1/projects/<p>.json`, `v1/repos/<o>/<r>.json`. Consumers merge the levels. */
export const KnowledgeSlice = z.strictObject({
  version: z.literal(1),
  commit: CommitSha,
  scope: KnowledgeScope,
  /** `repos/<o>/<r>/overview.md`, inlined in prompts. */
  overview: z.string().nullable(),
  rules: z.array(PublishedRule),
  lessons: z.array(PublishedLesson),
});
export type KnowledgeSlice = z.infer<typeof KnowledgeSlice>;

/** `v1/index.json`: every slice, with its rules' headlines. */
export const KnowledgeIndex = z.strictObject({
  version: z.literal(1),
  commit: CommitSha,
  slices: z.array(
    z.strictObject({
      scope: KnowledgeScope,
      kind: z.enum(["global", "project", "repo"]),
      /** Relative to the index, e.g. `projects/sandbox.json`. */
      path: z.string(),
      rules: z.array(PublishedRule.pick({ id: true, title: true, severity: true, appliesTo: true })),
      lessons: z.array(PublishedLesson.pick({ id: true, topic: true })),
    }),
  ),
});
export type KnowledgeIndex = z.infer<typeof KnowledgeIndex>;
