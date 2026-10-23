import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import type { ShellUser } from "#lib/session.js";

/** The signed-in user, or a 401. */
export function assertUser(user: ShellUser | null): ShellUser {
  if (user === null) error(401, "Sign in first.");
  return user;
}

/** The admin making the request, or a 401/403. */
export function assertAdmin(user: ShellUser | null): ShellUser {
  const signedIn = assertUser(user);
  if (!signedIn.isAdmin) error(403, "Only administrators can do this.");
  return signedIn;
}

/**
 * Remote functions are endpoints of their own: the page guard in hooks.server.ts never sees them
 * by route, so each checks its caller here first. The controller checks again; this keeps an
 * anonymous call from even reaching it.
 */
export function requireUser(): ShellUser {
  return assertUser(getRequestEvent().locals.user);
}

export function requireAdmin(): ShellUser {
  return assertAdmin(getRequestEvent().locals.user);
}
