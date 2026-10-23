import { invalid } from "@sveltejs/kit";
import { command, form, query } from "$app/server";
import { EndpointEnabled, EndpointInput } from "#lib/admin/forms.js";
import { requireAdmin } from "#lib/server/admin/access.js";
import { controller, fieldRefusal, unwrap } from "#lib/server/controller/index.js";
import { approveEndpoint as approve, listEndpoints, setEndpointEnabled as setEnabled } from "#lib/server/controller/generated/sdk.gen.js";

export const getEndpoints = query(async () => {
  requireAdmin();
  return unwrap(await listEndpoints({ client: controller() })).endpoints;
});

export const approveEndpoint = form(EndpointInput, async (body, issue) => {
  requireAdmin();
  const result = await approve({ client: controller(), body });
  const refusal = fieldRefusal(result);
  if (refusal !== undefined) invalid(refusal.field === "name" ? issue.name(refusal.message) : issue.baseUrl(refusal.message));
  const endpoint = unwrap(result);
  void getEndpoints().refresh();
  return { name: endpoint.name, baseUrl: endpoint.baseUrl };
});

export const setEndpointEnabled = command(EndpointEnabled, async ({ id, enabled }) => {
  requireAdmin();
  const endpoint = unwrap(await setEnabled({ client: controller(), path: { id }, body: { enabled } }));
  void getEndpoints().refresh();
  return { name: endpoint.name, enabled: endpoint.enabled };
});
