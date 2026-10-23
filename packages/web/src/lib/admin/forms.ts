import { Capability } from "@open-macaron/contracts/capability";
import { z } from "zod";

// The admin forms' inputs, shared by their remote functions (server validation) and the forms
// (preflight, in the browser). The controller checks them again: these only spare a round trip.

// Records are the controller's API types, from its generated client. Type-only: erased from the
// browser bundle, so nothing of the server-only client reaches it.
import type { GetMeResponse, GetMyUsageResponse, ListInvitationsResponse, ListUsersResponse } from "#lib/server/controller/generated/types.gen.js";

export type Invitation = ListInvitationsResponse["invitations"][number];
export type InvitationStatus = Invitation["status"];
export type UserAccount = ListUsersResponse["users"][number];
export type Me = GetMeResponse;
export type UsagePage = GetMyUsageResponse;
export type UsageRun = UsagePage["runs"][number];

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
