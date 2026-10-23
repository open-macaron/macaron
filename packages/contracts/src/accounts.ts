import { z } from "zod";
import { Capability } from "./capability.ts";
import { GitHubLogin } from "./ids.ts";

// The web app's API on the controller (/v1/me, /v1/admin). Dates travel as ISO strings.

const Timestamp = z.iso.datetime({ offset: true });

/** At least one capability, each once. */
export const Capabilities = z
  .array(Capability)
  .min(1, "grant at least one capability")
  .refine((capabilities) => new Set(capabilities).size === capabilities.length, "a capability appears twice");

export const Me = z.object({
  githubId: z.int().positive(),
  githubLogin: GitHubLogin,
  name: z.string(),
  avatarUrl: z.url().nullable(),
  role: z.enum(["user", "admin"]),
  capabilities: z.array(Capability),
});
export type Me = z.infer<typeof Me>;

export const InvitationStatus = z.enum(["pending", "accepted", "revoked", "expired"]);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

export const Invitation = z.object({
  id: z.uuid(),
  githubId: z.int().positive(),
  githubLogin: GitHubLogin,
  capabilities: z.array(Capability),
  invitedBy: GitHubLogin,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  status: InvitationStatus,
});
export type Invitation = z.infer<typeof Invitation>;

export const Invitations = z.object({ invitations: z.array(Invitation) });
export type Invitations = z.infer<typeof Invitations>;

export const CreateInvitation = z.object({ githubLogin: GitHubLogin, capabilities: Capabilities });
export type CreateInvitation = z.infer<typeof CreateInvitation>;

export const UserAccount = z.object({
  id: z.string().min(1),
  githubId: z.int().positive(),
  githubLogin: GitHubLogin,
  name: z.string(),
  avatarUrl: z.url().nullable(),
  role: z.enum(["user", "admin"]),
  capabilities: z.array(Capability),
  createdAt: Timestamp,
  lastSignInAt: Timestamp.nullable(),
});
export type UserAccount = z.infer<typeof UserAccount>;

export const UserAccounts = z.object({ users: z.array(UserAccount) });
export type UserAccounts = z.infer<typeof UserAccounts>;

export const SetCapabilities = z.object({ capabilities: Capabilities });
export type SetCapabilities = z.infer<typeof SetCapabilities>;

/** A refusal the web app shows on a form field: `{ error, field }`. */
export const FieldError = z.object({ error: z.string(), field: z.string(), message: z.string() });
export type FieldError = z.infer<typeof FieldError>;

export const UsageRun = z.object({
  id: z.uuid(),
  repo: z.string(),
  number: z.int().positive(),
  kind: z.enum(["issue", "pull"]),
  mode: z.string(),
  status: z.enum(["pending", "dispatched", "running", "completed", "failed", "aborted"]),
  model: z.string(),
  /** Settled cost; null until the backend reported the run's final usage. */
  costUsd: z.number().nonnegative().nullable(),
  createdAt: Timestamp,
});
export type UsageRun = z.infer<typeof UsageRun>;

export const UsagePage = z.object({
  runs: z.array(UsageRun),
  /** Pass as `before` for the next page; null on the last one. */
  nextCursor: z.string().nullable(),
  /** This calendar month (UTC), settled runs only. */
  monthUsd: z.number().nonnegative(),
  monthRuns: z.int().nonnegative(),
});
export type UsagePage = z.infer<typeof UsagePage>;

export const UsageQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type UsageQuery = z.infer<typeof UsageQuery>;
