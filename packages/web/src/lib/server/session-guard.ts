import type { RouteId } from "$app/types";
import type { ShellUser } from "#lib/session.js";

/** Where a request must go instead, or undefined to serve it. */
export type GuardRedirect = "/sign-in" | "/(app)";

/**
 * Every page of the (app) group needs a session; the sign-in page needs none. Routes outside both
 * (health check, unknown paths) are served as they are.
 */
export function sessionRedirect(routeId: RouteId | null, user: ShellUser | null): GuardRedirect | undefined {
  if (routeId === null) return undefined;
  if (user === null && (routeId === "/(app)" || routeId.startsWith("/(app)/"))) return "/sign-in";
  if (user !== null && routeId === "/sign-in") return "/(app)";
  return undefined;
}
