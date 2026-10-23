import { invalid } from "@sveltejs/kit";
import { form, query } from "$app/server";
import { CapabilitiesInput } from "#lib/admin/forms.js";
import { requireAdmin } from "#lib/server/admin/access.js";
import { controller, fieldRefusal, unwrap } from "#lib/server/controller/index.js";
import { listUsers, setUserCapabilities } from "#lib/server/controller/generated/sdk.gen.js";

export const getUsers = query(async () => {
  requireAdmin();
  return unwrap(await listUsers({ client: controller() })).users;
});

export const updateCapabilities = form(CapabilitiesInput, async ({ userId, capabilities }, issue) => {
  requireAdmin();
  const result = await setUserCapabilities({ client: controller(), path: { id: userId }, body: { capabilities } });
  const refusal = fieldRefusal(result);
  if (refusal !== undefined) invalid(issue.capabilities(refusal.message));
  const user = unwrap(result);
  void getUsers().refresh();
  return { githubLogin: user.githubLogin };
});
