import { z } from "zod";
import { Capability } from "./capability.ts";
import { GitHubLogin } from "./ids.ts";
import { Mode } from "./mode.ts";

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

/** What a user's runs may cost each calendar month (UTC), on their key; null for no cap of their own. */
export const MonthlyCapUsd = z.number().positive("a cap is above $0").max(100_000).multipleOf(0.01, "whole cents").nullable();

export const SetMonthlyCap = z.object({ monthlyCapUsd: MonthlyCapUsd });
export type SetMonthlyCap = z.infer<typeof SetMonthlyCap>;

/** The signed-in user's monthly cap, and what their key was billed this month (UTC). */
export const MyMonth = z.object({
  monthlyCapUsd: MonthlyCapUsd,
  /** Settled runs billed to this user's key. */
  spentUsd: z.number().nonnegative(),
  /** The limits of their runs not settled yet, counted against the cap until they are. */
  reservedUsd: z.number().nonnegative(),
});
export type MyMonth = z.infer<typeof MyMonth>;

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

const RunStatus = UsageRun.shape.status;

/** Who asked for a run: their account when they have one, else the login of the comment that triggered it. */
export const RunAsker = z.object({
  githubId: z.int().positive().nullable(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** False when no account has this GitHub id (a review bot, a deleted account). */
  hasAccount: z.boolean(),
});
export type RunAsker = z.infer<typeof RunAsker>;

export const AdminRun = UsageRun.extend({
  asker: RunAsker,
  /** The comment, review or issue that asked for the run. */
  triggerUrl: z.string(),
  instruction: z.string(),
  /** The workflow run in the runner repository; null until it was dispatched. */
  runUrl: z.string().nullable(),
  prNumber: z.int().positive().nullable(),
  limitUsd: z.number().nonnegative(),
  /** Why the run failed or was aborted, as the controller recorded it. */
  failure: z.string().nullable(),
  finishedAt: Timestamp.nullable(),
});
export type AdminRun = z.infer<typeof AdminRun>;

const ActivityFilters = z.object({
  /** The asker's GitHub id. */
  user: z.coerce.number().int().positive().optional(),
  repo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .optional(),
});

export const AdminRunsQuery = UsageQuery.extend(ActivityFilters.shape).extend({
  status: RunStatus.optional(),
  mode: Mode.optional(),
});
export type AdminRunsQuery = z.infer<typeof AdminRunsQuery>;

export const AdminRunsPage = z.object({
  runs: z.array(AdminRun),
  nextCursor: z.string().nullable(),
  /** This calendar month (UTC) under the same filters: settled cost, runs started, runs failed. */
  monthUsd: z.number().nonnegative(),
  monthRuns: z.int().nonnegative(),
  monthFailed: z.int().nonnegative(),
});
export type AdminRunsPage = z.infer<typeof AdminRunsPage>;

/** A request the bot refused to run (no key, a budget, a missing capability…). */
export const AdminRefusal = z.object({
  id: z.uuid(),
  repo: z.string(),
  number: z.int().positive(),
  kind: z.enum(["issue", "pull"]),
  author: z.string(),
  authorId: z.int().positive().nullable(),
  /** The comment that asked. */
  url: z.string(),
  /** Null for refusals recorded before reasons were kept. */
  reason: z.string().nullable(),
  createdAt: Timestamp,
});
export type AdminRefusal = z.infer<typeof AdminRefusal>;

export const AdminRefusalsQuery = UsageQuery.extend(ActivityFilters.shape);
export type AdminRefusalsQuery = z.infer<typeof AdminRefusalsQuery>;

export const AdminRefusalsPage = z.object({
  refusals: z.array(AdminRefusal),
  nextCursor: z.string().nullable(),
});
export type AdminRefusalsPage = z.infer<typeof AdminRefusalsPage>;

/**
 * An LLM endpoint an administrator approved: users' keys are only ever sent there. Its base URL
 * never changes (disable it and approve another): saved keys can't be redirected to a new host.
 */
export const Endpoint = z.object({
  id: z.uuid(),
  name: z.string(),
  baseUrl: z.url(),
  enabled: z.boolean(),
  pricingNote: z.string().nullable(),
  /** Null for the deployment's defaults (LLM_ENDPOINT_DEFAULTS). */
  createdBy: GitHubLogin.nullable(),
  createdAt: Timestamp,
});
export type Endpoint = z.infer<typeof Endpoint>;

export const Endpoints = z.object({ endpoints: z.array(Endpoint) });
export type Endpoints = z.infer<typeof Endpoints>;

/** https only, no credentials, query or fragment; a trailing slash is dropped. The controller also checks the host resolves to public addresses. */
export const EndpointBaseUrl = z
  .url({ protocol: /^https$/, error: "an https:// URL" })
  // Runs even when the URL check failed: parse without throwing, that issue is already reported.
  .refine((value) => {
    const url = URL.parse(value);
    return url === null || (url.username === "" && url.password === "" && url.search === "" && url.hash === "");
  }, "no credentials, query or fragment in the URL")
  .transform((value) => value.replace(/\/+$/, ""));

export const CreateEndpoint = z.object({
  name: z.string().trim().min(2).max(60),
  baseUrl: EndpointBaseUrl,
  pricingNote: z
    .string()
    .trim()
    .max(280)
    .nullish()
    .transform((note) => (note === undefined || note === null || note === "" ? null : note)),
});
export type CreateEndpoint = z.infer<typeof CreateEndpoint>;

export const SetEndpointEnabled = z.object({ enabled: z.boolean() });
export type SetEndpointEnabled = z.infer<typeof SetEndpointEnabled>;

/** An endpoint as users pick it for their key. */
export const EndpointChoice = Endpoint.pick({ id: true, name: true, baseUrl: true, pricingNote: true });
export type EndpointChoice = z.infer<typeof EndpointChoice>;

export const LlmKeyStatus = z.enum(["valid", "rejected"]);

/** A user's saved key, as its owner sees it: never the key itself, only its last 4 characters. */
export const LlmKey = z.object({
  endpoint: Endpoint.pick({ id: true, name: true, baseUrl: true, pricingNote: true, enabled: true }),
  last4: z.string(),
  /** `rejected` once the endpoint refused it during a run: save it again, or another. */
  status: LlmKeyStatus,
  validatedAt: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type LlmKey = z.infer<typeof LlmKey>;

export const MyLlmKey = z.object({
  key: LlmKey.nullable(),
  /** The enabled endpoints a key may be saved for. */
  endpoints: z.array(EndpointChoice),
  /** False when this deployment can't store keys (no key-encryption key): saving is refused. */
  storage: z.boolean(),
  /** Until when this session may save or delete a key; sign in again after. */
  freshUntil: Timestamp,
});
export type MyLlmKey = z.infer<typeof MyLlmKey>;

/** Printable ASCII without spaces: what every LLM API key looks like, and nothing a header could split on. */
export const SaveLlmKey = z.object({
  endpointId: z.uuid(),
  key: z
    .string()
    .trim()
    .min(8, "too short for an API key")
    .max(1024, "too long for an API key")
    .regex(/^[\x21-\x7e]+$/, "printable characters only, without spaces"),
});
export type SaveLlmKey = z.infer<typeof SaveLlmKey>;

export const SavedLlmKey = z.object({
  key: LlmKey,
  /** Models the configuration uses that the endpoint didn't list: runs needing them would fail. */
  missingModels: z.array(z.string()),
});
export type SavedLlmKey = z.infer<typeof SavedLlmKey>;

export const LlmKeyEventKind = z.enum(["created", "replaced", "deleted", "used", "rejected", "unreachable"]);

export const LlmKeyEvent = z.object({
  id: z.uuid(),
  kind: LlmKeyEventKind,
  at: Timestamp,
  endpointName: z.string().nullable(),
  last4: z.string().nullable(),
  /** The thread of the run that used the key, for `used` and `rejected` during a run. */
  thread: z.object({ repo: z.string(), number: z.int().positive(), kind: z.enum(["issue", "pull"]) }).nullable(),
  detail: z.string().nullable(),
});
export type LlmKeyEvent = z.infer<typeof LlmKeyEvent>;

export const LlmKeyEvents = z.object({ events: z.array(LlmKeyEvent), nextCursor: z.string().nullable() });
export type LlmKeyEvents = z.infer<typeof LlmKeyEvents>;

export const LlmKeyEventsQuery = UsageQuery;
export type LlmKeyEventsQuery = z.infer<typeof LlmKeyEventsQuery>;
