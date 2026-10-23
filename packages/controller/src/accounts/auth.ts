import { AUTH_COOKIE_PREFIX, authUserFields } from "@open-macaron/contracts";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";
import type { Db } from "../db/db.module.ts";
import { accounts, sessions, users, verifications } from "../db/schema.ts";

/** Whether a GitHub account may create a user, and as what. */
export type Admission = { readonly admitted: true; readonly role: "user" | "admin" } | { readonly admitted: false };

/** A user just created, and the GitHub account linked to it. */
export interface NewUser {
  readonly userId: string;
  readonly githubId: number;
}

export interface AuthDeps {
  readonly db: Db;
  /** The public origin (PUBLIC_URL): the edge sends /api/auth/* here, the web app serves the rest. */
  readonly baseUrl: string;
  readonly secret: string;
  readonly github: { readonly clientId: string; readonly clientSecret: string };
  /** Invited, or one of the operator's admins: who may create an account. */
  readonly admit: (githubId: number) => Promise<Admission>;
  /** Right after the account exists: its GitHub id and login, role, and capabilities (the invitation's, or all of them for an admin). */
  readonly onboard: (user: NewUser) => Promise<void>;
  /** A returning user's login, as GitHub gives it now: logins can be renamed. */
  readonly refreshLogin: (githubId: number, login: string) => Promise<void>;
}

/** The parts of GitHub's raw profile the gate reads (better-auth passes it unmapped). */
const GitHubIdentity = z.object({ id: z.coerce.number().int().positive(), login: z.string().min(1) });

const DAY_SECONDS = 86_400;

/**
 * The one better-auth instance: GitHub sign-in for invited accounts, sessions in Postgres. Security
 * choices (docs/DESIGN.md §7): GitHub's OAuth tokens are never stored (only the account id matters),
 * no IP address is kept, cookies are __Secure-, httpOnly and SameSite=Lax, sensitive actions need a
 * session younger than 10 minutes, and nothing is sent to better-auth's telemetry.
 */
export function createAuth(deps: AuthDeps): Auth {
  return betterAuth(authOptions(deps));
}

/** The options, kept literal so better-auth infers the session's user (githubId, githubLogin, role). */
function authOptions(deps: AuthDeps) {
  return {
    baseURL: deps.baseUrl,
    basePath: "/api/auth",
    secret: deps.secret,
    trustedOrigins: [deps.baseUrl],
    database: drizzleAdapter(deps.db, { provider: "pg", usePlural: true, schema: { users, sessions, accounts, verifications } }),
    telemetry: { enabled: false },
    // Only GitHub: no email and password, no other provider.
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: deps.github.clientId,
        clientSecret: deps.github.clientSecret,
        // Keeps name and avatar current. The login, a field no request may set, is refreshed by the gate below.
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          name: profile.name || profile.login,
          image: profile.avatar_url,
          // Never used to contact anyone; better-auth requires one. A private email is replaced by GitHub's noreply alias.
          email: profile.email ?? `${profile.id}+${profile.login}@users.noreply.github.com`,
        }),
      },
    },
    user: {
      additionalFields: authUserFields,
      // The gate, on GitHub's raw profile: a new account needs an invitation (or to be an admin),
      // a returning one refreshes its login, and no second account is ever linked to a user.
      validateUserInfo: async ({ source }) => {
        const identity = GitHubIdentity.safeParse(source.oauth?.profile);
        if (source.oauth?.providerId !== "github" || !identity.success) return { error: "not_invited" };
        switch (source.action) {
          case "create-user": {
            const admission = await deps.admit(identity.data.id);
            return admission.admitted ? undefined : { error: "not_invited", errorDescription: "This GitHub account has no invitation." };
          }
          case "sign-in":
            await deps.refreshLogin(identity.data.id, identity.data.login);
            return undefined;
          case "link-account":
            return { error: "account_not_linked" };
        }
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: (account) => Promise.resolve({ data: { ...account, ...NO_TOKENS } }),
          // The GitHub account is linked to the user created a moment ago, in the same request.
          after: async (account) => {
            if (account.providerId === "github") await deps.onboard({ userId: account.userId, githubId: Number(account.accountId) });
          },
        },
        update: { before: (account) => Promise.resolve({ data: { ...account, ...NO_TOKENS } }) },
      },
      session: {
        create: { before: (session) => Promise.resolve({ data: { ...session, ipAddress: null } }) },
      },
    },
    session: {
      expiresIn: 7 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      freshAge: 10 * 60,
    },
    rateLimit: { enabled: true, window: 60, max: 60, storage: "memory" },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: true,
      // Set by the edge from the router's view of the client (deploy/openshift/edge/nginx.conf), never by the client.
      ipAddress: { ipAddressHeaders: ["x-client-address"] },
    },
    onAPIError: { errorURL: `${deps.baseUrl}/sign-in` },
  } satisfies BetterAuthOptions;
}

/** What an account row keeps of GitHub's OAuth exchange: nothing. */
const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };

export type Auth = ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>>;
