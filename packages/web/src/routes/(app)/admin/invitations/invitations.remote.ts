import { invalid } from "@sveltejs/kit";
import { command, form, query } from "$app/server";
import { InvitationId, InvitationInput } from "#lib/admin/forms.js";
import { requireAdmin } from "#lib/server/admin/access.js";
import { controller, fieldRefusal, unwrap, unwrapEmpty } from "#lib/server/controller/index.js";
import { createInvitation as create, listInvitations, revokeInvitation as revoke } from "#lib/server/controller/generated/sdk.gen.js";

export const getInvitations = query(async () => {
  requireAdmin();
  return unwrap(await listInvitations({ client: controller() })).invitations;
});

export const createInvitation = form(InvitationInput, async (body, issue) => {
  requireAdmin();
  const result = await create({ client: controller(), body });
  const refusal = fieldRefusal(result);
  if (refusal !== undefined) invalid(issue.githubLogin(refusal.message));
  const invitation = unwrap(result);
  void getInvitations().refresh();
  return { githubLogin: invitation.githubLogin, expiresAt: invitation.expiresAt };
});

export const revokeInvitation = command(InvitationId, async ({ id }) => {
  requireAdmin();
  unwrapEmpty(await revoke({ client: controller(), path: { id } }));
  void getInvitations().refresh();
});
