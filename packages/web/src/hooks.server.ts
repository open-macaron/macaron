import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { resolve } from "$app/paths";
import { sessionRedirect } from "#lib/server/session-guard.js";

// Here rather than in a layout load: a hook runs before every load and endpoint of the request,
// so no page's data is ever computed for a visitor without a session.
export const handle: Handle = async ({ event, resolve: render }) => {
  // Sign-in lands with the controller's better-auth: until then nobody is signed in.
  event.locals.user = null;
  const target = sessionRedirect(event.route.id, event.locals.user);
  if (target !== undefined) redirect(303, resolve(target));
  return render(event);
};
