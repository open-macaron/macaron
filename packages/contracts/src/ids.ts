import { z } from "zod";

/** GitHub login: 1–39 alphanumerics or single hyphens; bot logins end with `[bot]`. */
export const GitHubLogin = z
  .string()
  .regex(/^(?!-)[A-Za-z0-9-]{1,39}(?<!-)(\[bot\])?$/, "not a GitHub login")
  .brand<"GitHubLogin">();
export type GitHubLogin = z.infer<typeof GitHubLogin>;

/** `owner/name` of a GitHub repository. */
export const RepoSlug = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "expected owner/name")
  .brand<"RepoSlug">();
export type RepoSlug = z.infer<typeof RepoSlug>;

/** Full 40-hex git commit SHA. */
export const CommitSha = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full commit SHA")
  .brand<"CommitSha">();
export type CommitSha = z.infer<typeof CommitSha>;

/** Branch the controller owns on the bot's fork: `macaron/<number>-<slug>`. */
export const BotBranch = z
  .string()
  .regex(/^macaron\/[0-9]+-[a-z0-9-]{1,48}$/, "expected macaron/<number>-<slug>")
  .brand<"BotBranch">();
export type BotBranch = z.infer<typeof BotBranch>;

/** Opaque one-time ticket handed to a run through workflow_dispatch. */
export const Ticket = z
  .string()
  .regex(/^t_[A-Za-z0-9_-]{32,64}$/, "not a ticket")
  .brand<"Ticket">();
export type Ticket = z.infer<typeof Ticket>;

/** Kebab-case identifier for projects and environment names. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected kebab-case")
  .max(64)
  .brand<"Slug">();
export type Slug = z.infer<typeof Slug>;

/** Positive amount of US dollars. */
export const Usd = z.number().nonnegative().max(1000);
