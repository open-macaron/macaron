import { Inject, Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { Forbidden, SignInRequired, SignInUnavailable } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import type { Db } from "../db/db.module.ts";
import { type Auth, createAuth } from "./auth.ts";
import { InvitationsService } from "./invitations.service.ts";

/** The signed-in user a request acts as. */
export interface SessionUser {
  readonly id: string;
  readonly githubId: number;
  readonly githubLogin: string;
  readonly name: string;
  readonly image: string | null;
  readonly role: "user" | "admin";
  /** When this session was created, at sign-in: renewals don't move it. */
  readonly signedInAt: Date;
}

/**
 * Holds the better-auth instance (none when sign-in isn't configured) and answers "who is this
 * request?" for the controller's own routes. Every /v1/me and /v1/admin handler starts here.
 */
@Injectable()
export class SessionsService {
  readonly auth: Auth | undefined;

  constructor(@InjectDrizzle() db: Db, @Inject(APP_ENV) env: AppEnv, invitations: InvitationsService) {
    this.auth =
      env.auth === undefined
        ? undefined
        : createAuth({
            db,
            baseUrl: env.PUBLIC_URL,
            secret: env.auth.secret,
            github: { clientId: env.auth.githubClientId, clientSecret: env.auth.githubClientSecret },
            admit: (githubId) => invitations.admit(githubId),
            onboard: (user) => invitations.onboard(user),
            refreshLogin: (githubId, login) => invitations.refreshLogin(githubId, login),
          });
  }

  /** The request's user, or SignInRequired. */
  async user(headers: IncomingHttpHeaders): Promise<SessionUser> {
    if (this.auth === undefined) throw new SignInUnavailable("sign-in is not configured");
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (session === null) throw new SignInRequired("no valid session");
    const { user } = session;
    // Onboarding writes the GitHub identity in the sign-up request itself: a user without one never finished it.
    if (user.githubId === null || user.githubId === undefined || user.githubLogin === null || user.githubLogin === undefined) throw new SignInRequired("account not onboarded");
    return { id: user.id, githubId: user.githubId, githubLogin: user.githubLogin, name: user.name, image: user.image ?? null, role: user.role === "admin" ? "admin" : "user", signedInAt: session.session.createdAt };
  }

  /** The request's user if they are an admin, or SignInRequired / Forbidden. */
  async admin(headers: IncomingHttpHeaders): Promise<SessionUser> {
    const user = await this.user(headers);
    if (user.role !== "admin") throw new Forbidden(`@${user.githubLogin} is not an admin`);
    return user;
  }
}
