import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { SESSION_COOKIE } from "@open-macaron/contracts/auth";
import { CONTROLLER_URL } from "$app/env/private";
import { resolve } from "$app/paths";
import { sessionUser } from "#lib/server/session.js";
import { sessionRedirect } from "#lib/server/session-guard.js";

// Here rather than in a layout load: a hook runs before every load and endpoint of the request,
// so no page's data is ever computed for a visitor without a session. Remote functions are
// endpoints the guard doesn't see by route: each checks `locals.user` itself (requireUser…).
export const handle: Handle = async ({ event, resolve: render }) => {
  event.locals.user = CONTROLLER_URL === undefined ? null : await sessionUser(CONTROLLER_URL, event.cookies.get(SESSION_COOKIE));
  const target = sessionRedirect(event.route.id, event.locals.user);
  if (target !== undefined) redirect(303, resolve(target));
  return render(event);
};
