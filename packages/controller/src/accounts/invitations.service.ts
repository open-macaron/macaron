import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type Capability, Capability as Capabilities, GitHubLogin, type Invitation } from "@open-macaron/contracts";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { Clock } from "../common/clock.ts";
import { FieldRefused } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import type { Db } from "../db/db.module.ts";
import { adminAudit, invitations, users } from "../db/schema.ts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { describeError } from "../common/errors.ts";
import type { Admission, NewUser } from "./auth.ts";

/** How long an invitation can be used for a first sign-in. */
export const INVITATION_TTL_MS = 7 * 86_400_000;

/** Someone acting on the admin pages: their user id, and login for the records. */
export interface Actor {
  readonly id: string;
  readonly githubLogin: string;
}

/**
 * Who may create an account. An admin invites a GitHub login; the controller resolves it to the
 * account's immutable id right away, so a renamed or re-registered login can't use the invitation.
 * The operator's admins (MACARON_ADMIN_USER_IDS) need none.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly clock: Clock,
  ) {}

  private isAdmin(githubId: number): boolean {
    return this.env.auth?.adminGithubIds.has(githubId) ?? false;
  }

  /** The gate better-auth calls before creating a user. */
  async admit(githubId: number): Promise<Admission> {
    if (this.isAdmin(githubId)) return { admitted: true, role: "admin" };
    const [pending] = await this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.githubId, githubId), eq(invitations.status, "pending"), gt(invitations.expiresAt, this.clock.now())))
      .limit(1);
    return pending === undefined ? { admitted: false } : { admitted: true, role: "user" };
  }

  /**
   * Right after better-auth created the user and linked its GitHub account: who it is on GitHub,
   * its role, and its capabilities. An admin holds every one; anyone else gets their invitation's,
   * which is used up.
   */
  async onboard({ userId, githubId }: NewUser): Promise<void> {
    const login = await this.currentLogin(githubId);
    if (this.isAdmin(githubId)) {
      await this.db.update(users).set({ githubId, githubLogin: login ?? String(githubId), role: "admin", capabilities: Capabilities.options }).where(eq(users.id, userId));
      return;
    }
    await this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .update(invitations)
        .set({ status: "accepted" })
        .where(and(eq(invitations.githubId, githubId), eq(invitations.status, "pending"), gt(invitations.expiresAt, this.clock.now())))
        .returning({ capabilities: invitations.capabilities, githubLogin: invitations.githubLogin });
      // The gate let this account in a moment ago; an invitation revoked in between leaves it without capabilities.
      if (invitation === undefined) this.logger.warn(`user ${userId} signed up without a pending invitation: no capabilities`);
      await tx
        .update(users)
        .set({ githubId, githubLogin: login ?? invitation?.githubLogin ?? String(githubId), capabilities: invitation?.capabilities ?? [] })
        .where(eq(users.id, userId));
    });
  }

  /** A returning user's login, from the profile GitHub just sent. */
  async refreshLogin(githubId: number, login: string): Promise<void> {
    await this.db.update(users).set({ githubLogin: login }).where(eq(users.githubId, githubId));
  }

  /** The account's login today; undefined if GitHub can't say (the invitation's login then stands in). */
  private async currentLogin(githubId: number): Promise<string | undefined> {
    try {
      const { data } = await this.gh.request("GET /user/{account_id}", { account_id: githubId });
      return data.login;
    } catch (error) {
      this.logger.warn(`login of GitHub account ${String(githubId)} unavailable: ${describeError(error)}`);
      return undefined;
    }
  }

  async list(): Promise<Invitation[]> {
    const rows = await this.db
      .select({ invitation: invitations, invitedBy: users.githubLogin })
      .from(invitations)
      .innerJoin(users, eq(users.id, invitations.invitedBy))
      .orderBy(desc(invitations.createdAt))
      .limit(500);
    const now = this.clock.now();
    return rows.map(({ invitation, invitedBy }) => ({
      id: invitation.id,
      githubId: invitation.githubId,
      githubLogin: GitHubLogin.parse(invitation.githubLogin),
      capabilities: invitation.capabilities,
      invitedBy: GitHubLogin.parse(invitedBy),
      createdAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      status: invitation.status === "pending" && invitation.expiresAt <= now ? "expired" : invitation.status,
    }));
  }

  async invite(login: GitHubLogin, capabilities: readonly Capability[], by: Actor): Promise<Invitation> {
    const account = await this.githubAccount(login);
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.githubId, account.id)).limit(1);
    if (existing !== undefined) throw new FieldRefused("githubLogin", `@${account.login} already has an account: edit their capabilities on the Users page.`);
    const now = this.clock.now();
    const created = await this.db.transaction(async (tx) => {
      // A pending invitation past its date no longer blocks a new one (one pending per account, by index).
      await tx
        .update(invitations)
        .set({ status: "expired" })
        .where(and(eq(invitations.githubId, account.id), eq(invitations.status, "pending"), lte(invitations.expiresAt, now)));
      const [pending] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(and(eq(invitations.githubId, account.id), eq(invitations.status, "pending")))
        .limit(1);
      if (pending !== undefined) throw new FieldRefused("githubLogin", `@${account.login} already has a pending invitation.`);
      const [row] = await tx
        .insert(invitations)
        .values({ githubId: account.id, githubLogin: account.login, capabilities: [...capabilities], invitedBy: by.id, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) })
        .returning();
      if (row === undefined) throw new Error("invitation insert returned nothing");
      await tx.insert(adminAudit).values({ actorId: by.id, action: "invitation.create", target: `github:${String(account.id)}`, details: { login: account.login, capabilities: [...capabilities] } });
      return row;
    });
    return {
      id: created.id,
      githubId: created.githubId,
      githubLogin: GitHubLogin.parse(created.githubLogin),
      capabilities: created.capabilities,
      invitedBy: GitHubLogin.parse(by.githubLogin),
      createdAt: created.createdAt.toISOString(),
      expiresAt: created.expiresAt.toISOString(),
      status: "pending",
    };
  }

  /** Revokes a pending invitation; anything else is left as it is. */
  async revoke(id: string, by: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ status: "revoked" })
        .where(and(eq(invitations.id, id), eq(invitations.status, "pending")))
        .returning({ githubId: invitations.githubId });
      if (revoked !== undefined) await tx.insert(adminAudit).values({ actorId: by.id, action: "invitation.revoke", target: `github:${String(revoked.githubId)}`, details: { invitation: id } });
    });
  }

  /** The account behind a login, as GitHub knows it now (canonical case, immutable id). */
  private async githubAccount(login: GitHubLogin): Promise<{ readonly id: number; readonly login: string }> {
    try {
      const { data } = await this.gh.rest.users.getByUsername({ username: login });
      if (data.type !== "User") throw new FieldRefused("githubLogin", `@${data.login} is ${data.type === "Organization" ? "an organization" : "not a person"}.`);
      return { id: data.id, login: data.login };
    } catch (error) {
      if (error instanceof FieldRefused) throw error;
      if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
        throw new FieldRefused("githubLogin", `No GitHub account is called @${login}.`);
      }
      throw error;
    }
  }
}
