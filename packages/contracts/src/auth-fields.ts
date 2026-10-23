/**
 * The fields better-auth adds to its user, declared once: the controller's `user.additionalFields`
 * and the web app's `inferAdditionalFields(...)` both use this object, so a session's user is typed
 * the same on both sides. `input: false`: no request can set them, a provider profile included;
 * the controller writes them when the GitHub account is linked (accounts/auth.ts).
 * Browser-safe (`@open-macaron/contracts/auth`): no import.
 */
export const authUserFields = {
  /** GitHub's immutable account id: who the user is, whatever their login becomes. Set right after creation. */
  githubId: { type: "number", required: false, input: false },
  githubLogin: { type: "string", required: false, input: false },
  role: { type: "string", required: true, input: false, defaultValue: "user" },
} satisfies Readonly<Record<string, { type: "number" | "string"; required: boolean; input: boolean; defaultValue?: string }>>;

/** Roles: an admin invites people and grants capabilities. */
export type Role = "user" | "admin";

/** better-auth's cookie prefix. */
export const AUTH_COOKIE_PREFIX = "macaron";

/** The session cookie, as browsers hold it (secure cookies: `__Secure-` prefix). The only cookie the web app forwards. */
export const SESSION_COOKIE = `__Secure-${AUTH_COOKIE_PREFIX}.session_token`;
