import { Capability } from "@open-macaron/contracts/capability";
import { z } from "zod";

// The admin forms' inputs, shared by their remote functions (server validation) and the forms
// (preflight, in the browser). The controller checks them again: these only spare a round trip.

// Records are the controller's API types, from its generated client. Type-only: erased from the
// browser bundle, so nothing of the server-only client reaches it.
import type { GetMeResponse, GetMyUsageResponse, ListEndpointsResponse, ListInvitationsResponse, ListRefusalsResponse, ListRunsData, ListRunsResponse, ListUsersResponse } from "#lib/server/controller/generated/types.gen.js";

export type Invitation = ListInvitationsResponse["invitations"][number];
export type InvitationStatus = Invitation["status"];
export type UserAccount = ListUsersResponse["users"][number];
export type Me = GetMeResponse;
export type UsagePage = GetMyUsageResponse;
export type UsageRun = UsagePage["runs"][number];
export type AdminRunsPage = ListRunsResponse;
export type AdminRun = AdminRunsPage["runs"][number];
export type AdminRefusal = ListRefusalsResponse["refusals"][number];
export type RunStatus = UsageRun["status"];
export type RunMode = NonNullable<NonNullable<ListRunsData["query"]>["mode"]>;

/** Every run mode, as the activity page's filter lists them. */
export const runModeLabels: Readonly<Record<RunMode, string>> = {
  triage: "Triage",
  plan: "Plan",
  implement: "Implement",
  address_review: "Address review",
  reproduce: "Reproduce",
  verify: "Verify",
  retro: "Retro",
  review: "Review",
};

/** Every run status, as users read it. */
export const runStatusLabels: Readonly<Record<RunStatus, string>> = {
  pending: "Queued",
  dispatched: "Starting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  aborted: "Stopped",
};

/** "Address review"; a mode this app doesn't know yet reads as the controller sent it. */
export function runModeLabel(mode: string): string {
  return isRunMode(mode) ? runModeLabels[mode] : mode;
}

function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && Object.hasOwn(runModeLabels, value);
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && Object.hasOwn(runStatusLabels, value);
}

const RepoSlug = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const ActivityFilter = {
  user: z.coerce.number().int().positive(),
  repo: RepoSlug,
  status: z.custom<RunStatus>(isRunStatus),
  mode: z.custom<RunMode>(isRunMode),
};

/** The activity page's filters, from its URL: shareable, and a Users row links to one user's runs. */
export const ActivityFilters = z.object({
  user: ActivityFilter.user.optional(),
  repo: ActivityFilter.repo.optional(),
  status: ActivityFilter.status.optional(),
  mode: ActivityFilter.mode.optional(),
});
export type ActivityFilters = z.infer<typeof ActivityFilters>;

/** The valid filters of a URL; a hand-edited, invalid one is ignored rather than failing the page. */
export function activityFiltersOf(params: Pick<URLSearchParams, "get">): ActivityFilters {
  const valid = <T>(schema: z.ZodType<T>, key: string): T | undefined => {
    const result = schema.safeParse(params.get(key) ?? undefined);
    return result.success ? result.data : undefined;
  };
  return { user: valid(ActivityFilter.user, "user"), repo: valid(ActivityFilter.repo, "repo"), status: valid(ActivityFilter.status, "status"), mode: valid(ActivityFilter.mode, "mode") };
}
export type Endpoint = ListEndpointsResponse["endpoints"][number];

/** GitHub's own rule: 1–39 characters, alphanumerics and single inner hyphens. */
const GitHubLogin = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, "Enter a GitHub login, like octocat.");

/** Unchecked boxes send nothing: an absent list is an empty one, which is then refused. */
const Capabilities = z
  .array(Capability)
  .optional()
  .transform((capabilities) => [...new Set(capabilities ?? [])])
  .pipe(z.array(Capability).min(1, "Grant at least one capability."));

export const InvitationInput = z.object({ githubLogin: GitHubLogin, capabilities: Capabilities });

export const CapabilitiesInput = z.object({ userId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), capabilities: Capabilities });

export const InvitationId = z.object({ id: z.uuid() });

export const EndpointInput = z.object({
  name: z.string().trim().min(2, "Name it, in 2 to 60 characters.").max(60, "Name it, in 2 to 60 characters."),
  // The controller normalises the URL and checks its host resolves to public addresses.
  baseUrl: z
    .url({ protocol: /^https$/, error: "Enter an https:// URL, like https://api.anthropic.com." })
    .refine((value) => {
      const url = URL.parse(value);
      return url === null || (url.username === "" && url.password === "" && url.search === "" && url.hash === "");
    }, "Leave out credentials, query and fragment."),
  pricingNote: z
    .string()
    .trim()
    .max(280, "Keep the note under 280 characters.")
    .optional()
    .transform((note) => (note === undefined || note === "" ? null : note)),
});

export const EndpointEnabled = z.object({ id: z.uuid(), enabled: z.boolean() });
