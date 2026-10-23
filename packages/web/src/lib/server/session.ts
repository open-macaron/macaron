import { authUserFields, SESSION_COOKIE } from "@open-macaron/contracts/auth";
import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { ShellUser } from "#lib/session.js";

/** The controller's sign-in API, asked from the server: typed like the browser's client. */
function sessionClient(controllerUrl: string) {
  return createAuthClient({ baseURL: controllerUrl, basePath: "/api/auth", plugins: [inferAdditionalFields({ user: authUserFields })] });
}

let client: ReturnType<typeof sessionClient> | undefined;

/**
 * Who the session cookie belongs to, as the controller says; null without one, or when it is
 * expired, revoked, or belongs to an account that never finished signing up. Only the session
 * cookie is sent: nothing else of the browser's request reaches the controller.
 */
export async function sessionUser(controllerUrl: string, sessionToken: string | undefined): Promise<ShellUser | null> {
  if (sessionToken === undefined) return null;
  client ??= sessionClient(controllerUrl);
  const { data } = await client.getSession({ fetchOptions: { headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` } } });
  const user = data?.user;
  if (user?.githubLogin === undefined || user.githubLogin === null) return null;
  return { githubLogin: user.githubLogin, name: user.name, avatarUrl: user.image ?? `https://avatars.githubusercontent.com/${user.githubLogin}`, isAdmin: user.role === "admin" };
}
