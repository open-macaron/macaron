import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type Capability, GitHubLogin, type UserAccount } from "@open-macaron/contracts";
import { asc, eq, max } from "drizzle-orm";
import { FieldRefused } from "../common/errors.ts";
import type { Db } from "../db/db.module.ts";
import { adminAudit, sessions, users } from "../db/schema.ts";
import type { Actor } from "./invitations.service.ts";

type UserRow = typeof users.$inferSelect;

function toAccount(user: UserRow, lastSignInAt: Date | null): UserAccount | undefined {
  // A user whose onboarding never finished has no GitHub identity: not an account yet.
  if (user.githubId === null || user.githubLogin === null) return undefined;
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: GitHubLogin.parse(user.githubLogin),
    name: user.name,
    avatarUrl: user.image,
    role: user.role,
    capabilities: user.capabilities,
    createdAt: user.createdAt.toISOString(),
    lastSignInAt: lastSignInAt?.toISOString() ?? null,
  };
}

/** Accounts and what each may ask the bot for. */
@Injectable()
export class UsersService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  async get(id: string): Promise<UserAccount | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row === undefined ? undefined : toAccount(row, null);
  }

  async list(): Promise<UserAccount[]> {
    const rows = await this.db
      .select({ user: users, lastSignInAt: max(sessions.createdAt) })
      .from(users)
      .leftJoin(sessions, eq(sessions.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.createdAt));
    return rows.flatMap(({ user, lastSignInAt }) => toAccount(user, lastSignInAt) ?? []);
  }

  /** An admin changes a user's capabilities. Admins hold every capability: theirs never change here. */
  async setCapabilities(id: string, capabilities: readonly Capability[], by: Actor): Promise<UserAccount> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1).for("update");
      if (user === undefined) throw new FieldRefused("userId", "This user no longer exists.");
      if (user.role === "admin") throw new FieldRefused("capabilities", "Admins hold every capability.");
      const [updated] = await tx.update(users).set({ capabilities: [...capabilities] }).where(eq(users.id, id)).returning();
      if (updated === undefined) throw new Error("user update returned nothing");
      await tx.insert(adminAudit).values({ actorId: by.id, action: "user.capabilities", target: `user:${id}`, details: { before: user.capabilities, after: [...capabilities] } });
      const account = toAccount(updated, null);
      if (account === undefined) throw new FieldRefused("userId", "This user never finished signing up.");
      return account;
    });
  }
}
