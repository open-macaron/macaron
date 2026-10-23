import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Capability, GitHubLogin, Ticket } from "@open-macaron/contracts";
import { eq, sql } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAuth } from "../../src/accounts/auth.ts";
import { InvitationsService, INVITATION_TTL_MS } from "../../src/accounts/invitations.service.ts";
import { SessionsService } from "../../src/accounts/sessions.service.ts";
import { UsageService } from "../../src/accounts/usage.service.ts";
import { UsersService } from "../../src/accounts/users.service.ts";
import { FieldRefused, Forbidden, SignInRequired } from "../../src/common/errors.ts";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { accounts, adminAudit, runs as runsTable, users } from "../../src/db/schema.ts";
import { createGitHub } from "../../src/github/github.ts";
import { RunsRepository } from "../../src/runs/runs.repository.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext } from "../support/fixtures.ts";
import { startPostgres } from "../support/postgres.ts";

const ADMIN_GITHUB_ID = 1;
const authVariables = {
  BETTER_AUTH_SECRET: "better-auth-secret-for-tests-0123456789",
  GITHUB_LOGIN_CLIENT_ID: "Iv23test",
  GITHUB_LOGIN_CLIENT_SECRET: "github-login-secret-for-tests-0000",
};
const env = testEnv({ ...authVariables, MACARON_ADMIN_USER_IDS: String(ADMIN_GITHUB_ID) });
const admin = { id: "admin-user", githubLogin: "octocat" };

let container: StartedPostgreSqlContainer;
let db: Db;
let clock: FakeClock;
let service: InvitationsService;
const server = setupServer();

/** GitHub's users API, as far as these tests need it. */
const githubUsers: Record<string, { id: number; login: string; type: string }> = {
  monalisa: { id: 101, login: "monalisa", type: "User" },
  hubot: { id: 102, login: "Hubot", type: "User" },
  github: { id: 9919, login: "github", type: "Organization" },
};

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await db.insert(users).values({ id: admin.id, name: "The Octocat", email: "octocat@example.test", githubId: ADMIN_GITHUB_ID, githubLogin: admin.githubLogin, role: "admin", capabilities: Capability.options });
  server.listen({ onUnhandledFrame: "bypass" });
});
beforeEach(() => {
  clock = new FakeClock(new Date("2026-10-23T12:00:00Z"));
  service = new InvitationsService(db, createGitHub("test", "ghp_test_interact_000000000000000000", "2026-03-10"), env, clock);
  server.use(
    http.get("https://api.github.com/users/:login", ({ params }) => {
      const user = githubUsers[String(params["login"]).toLowerCase()];
      return user === undefined ? HttpResponse.json({ message: "Not Found" }, { status: 404 }) : HttpResponse.json(user);
    }),
  );
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(async () => {
  server.close();
  await db.$client.end();
  await container.stop();
});

async function refusal(promise: Promise<unknown>): Promise<FieldRefused> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FieldRefused) return error;
    throw error;
  }
  throw new Error("expected a FieldRefused");
}

describe("the capability enum", () => {
  it("has exactly the contract's values, in order", async () => {
    const result = await db.execute<{ value: string }>(sql`SELECT unnest(enum_range(NULL::capability))::text AS value`);
    expect(result.rows.map((row) => row.value)).toEqual(Capability.options);
  });
});

describe("InvitationsService", () => {
  it("admits the operator's admins without an invitation, and nobody else", async () => {
    expect(await service.admit(ADMIN_GITHUB_ID)).toEqual({ admitted: true, role: "admin" });
    expect(await service.admit(424242)).toEqual({ admitted: false });
  });

  it("invites by the account's immutable id, with GitHub's spelling of the login", async () => {
    const invitation = await service.invite(GitHubLogin.parse("hubot"), ["triage", "review"], admin);
    expect(invitation).toMatchObject({ githubId: 102, githubLogin: "Hubot", capabilities: ["triage", "review"], status: "pending", invitedBy: "octocat" });
    expect(await service.admit(102)).toEqual({ admitted: true, role: "user" });
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.target, "github:102"));
    expect(audit?.action).toBe("invitation.create");
  });

  it("refuses unknown logins, organizations, and a second pending invitation", async () => {
    expect((await refusal(service.invite(GitHubLogin.parse("nobody-here"), ["triage"], admin))).field).toBe("githubLogin");
    expect((await refusal(service.invite(GitHubLogin.parse("github"), ["triage"], admin))).message).toMatch(/organization/);
    expect((await refusal(service.invite(GitHubLogin.parse("hubot"), ["plan"], admin))).message).toMatch(/pending invitation/);
  });

  it("refuses someone who already has an account", async () => {
    expect((await refusal(service.invite(GitHubLogin.parse("octocat"), ["triage"], admin).catch(() => {
      throw new FieldRefused("githubLogin", "octocat isn't in the fake users API");
    }))).field).toBe("githubLogin");
    githubUsers["octocat"] = { id: ADMIN_GITHUB_ID, login: "octocat", type: "User" };
    expect((await refusal(service.invite(GitHubLogin.parse("octocat"), ["triage"], admin))).message).toMatch(/already has an account/);
  });

  it("lets an expired invitation be replaced, and no longer admits it", async () => {
    await service.invite(GitHubLogin.parse("monalisa"), ["plan"], admin);
    clock.advance(INVITATION_TTL_MS + 1);
    expect(await service.admit(101)).toEqual({ admitted: false });
    expect((await service.list()).find((invitation) => invitation.githubId === 101)?.status).toBe("expired");
    const again = await service.invite(GitHubLogin.parse("monalisa"), ["verify"], admin);
    expect(again.status).toBe("pending");
    expect(await service.admit(101)).toEqual({ admitted: true, role: "user" });
  });

  it("revokes pending invitations only", async () => {
    const pending = (await service.list()).find((invitation) => invitation.githubId === 101 && invitation.status === "pending");
    if (pending === undefined) throw new Error("no pending invitation for monalisa");
    await service.revoke(pending.id, admin);
    expect(await service.admit(101)).toEqual({ admitted: false });
  });
});

describe("GitHub sign-in through better-auth", () => {
  /** better-auth wired to an invitations service, as SessionsService does it. Built on first use: the database is connected in beforeAll. */
  function authWith(invitations_: InvitationsService): ReturnType<typeof createAuth> {
    return createAuth({
      db,
      baseUrl: env.PUBLIC_URL,
      secret: "better-auth-secret-for-tests-0123456789",
      github: { clientId: "Iv23test", clientSecret: "github-login-secret-for-tests-0000" },
      admit: (githubId) => invitations_.admit(githubId),
      onboard: (user) => invitations_.onboard(user),
      refreshLogin: (githubId, login) => invitations_.refreshLogin(githubId, login),
    });
  }

  /** GitHub's side of the OAuth exchange (and its users API), answering as the given account. */
  function githubAnswersAs(account: { id: number; login: string }): void {
    server.use(
      http.post("https://github.com/login/oauth/access_token", () => HttpResponse.json({ access_token: "gho_secret_access", token_type: "bearer", scope: "read:user,user:email" })),
      http.get("https://api.github.com/user", () => HttpResponse.json({ ...account, name: account.login, avatar_url: `https://avatars.githubusercontent.com/u/${String(account.id)}`, email: null })),
      http.get("https://api.github.com/user/emails", () => HttpResponse.json([{ email: `${account.login}@example.test`, primary: true, verified: true }])),
      http.get("https://api.github.com/user/:id", ({ params }) => (String(params["id"]) === String(account.id) ? HttpResponse.json({ id: account.id, login: account.login, type: "User" }) : HttpResponse.json({}, { status: 404 }))),
    );
  }

  /** Each sign-in from its own address: better-auth allows only a few per address every 10 seconds. */
  let address = 0;

  /** Clicks "Continue with GitHub", then comes back from GitHub: what the browser would get. */
  async function signIn(auth: ReturnType<typeof createAuth>): Promise<Response> {
    address += 1;
    const start = await auth.handler(
      new Request(`${env.PUBLIC_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.PUBLIC_URL, "x-client-address": `203.0.113.${String(address)}` },
        body: JSON.stringify({ provider: "github", callbackURL: "/", errorCallbackURL: "/sign-in" }),
      }),
    );
    const { url } = z.object({ url: z.url() }).parse(await start.json());
    const state = new URL(url).searchParams.get("state") ?? "";
    const cookies = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    return auth.handler(new Request(`${env.PUBLIC_URL}/api/auth/callback/github?code=fake-code&state=${state}`, { headers: { cookie: cookies } }));
  }

  it("refuses a GitHub account without an invitation, and creates nothing", async () => {
    githubAnswersAs({ id: 555, login: "stranger" });
    const response = await signIn(authWith(service));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/\/sign-in\?error=not_invited/);
    expect(response.headers.getSetCookie().some((cookie) => cookie.includes("session_token=") && !cookie.includes("Max-Age=0"))).toBe(false);
    expect(await db.select().from(users).where(eq(users.githubId, 555))).toEqual([]);
    expect(await db.select().from(users).where(eq(users.email, "stranger@example.test"))).toEqual([]);
  });

  it("signs an invited account in: its capabilities, a secure cookie, no GitHub token kept", async () => {
    githubAnswersAs({ id: 102, login: "Hubot" });
    const response = await signIn(authWith(service));
    expect(response.status).toBe(302);
    expect(response.headers.get("location"), response.headers.get("location") ?? "").toBe("/");
    const session = response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Secure-macaron.session_token="));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Lax/i);

    const [hubot] = await db.select().from(users).where(eq(users.githubId, 102));
    expect(hubot).toMatchObject({ githubLogin: "Hubot", role: "user", capabilities: ["triage", "review"] });
    expect(await service.admit(102)).toEqual({ admitted: false });
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, hubot?.id ?? ""));
    expect(account).toMatchObject({ providerId: "github", accountId: "102", accessToken: null, refreshToken: null, idToken: null });

    // What the web app forwards: the session cookie alone. The controller's routes know who it is.
    const sessions = new SessionsService(db, env, service);
    const cookie = { cookie: (session ?? "").split(";")[0] ?? "" };
    expect(await sessions.user(cookie)).toMatchObject({ githubId: 102, githubLogin: "Hubot", role: "user" });
    await expect(sessions.admin(cookie)).rejects.toThrow(Forbidden);
    await expect(sessions.user({})).rejects.toThrow(SignInRequired);
    await expect(sessions.user({ cookie: "__Secure-macaron.session_token=forged.value" })).rejects.toThrow(SignInRequired);
  });

  it("follows a renamed login at the next sign-in", async () => {
    githubAnswersAs({ id: 102, login: "hubot-renamed" });
    const response = await signIn(authWith(service));
    expect(response.headers.get("location")).toBe("/");
    const [hubot] = await db.select().from(users).where(eq(users.githubId, 102));
    expect(hubot?.githubLogin).toBe("hubot-renamed");
    githubUsers["hubot"] = { id: 102, login: "hubot-renamed", type: "User" };
  });

  it("signs the operator's admins in without an invitation, with every capability", async () => {
    const withSecondAdmin = new InvitationsService(db, createGitHub("test", "ghp_test_interact_000000000000000000", "2026-03-10"), testEnv({ ...authVariables, MACARON_ADMIN_USER_IDS: "1,2" }), clock);
    githubAnswersAs({ id: 2, login: "admin-two" });
    const response = await signIn(authWith(withSecondAdmin));
    expect(response.headers.get("location")).toBe("/");
    const [row] = await db.select().from(users).where(eq(users.githubId, 2));
    expect(row).toMatchObject({ githubLogin: "admin-two", role: "admin", capabilities: Capability.options });
  });
});

describe("UsersService", () => {
  it("lists every account and changes a user's capabilities, with an audit record", async () => {
    const users_ = new UsersService(db);
    const [hubot] = (await users_.list()).filter((user) => user.githubId === 102);
    if (hubot === undefined) throw new Error("hubot is not listed");
    const updated = await users_.setCapabilities(hubot.id, ["implement"], admin);
    expect(updated.capabilities).toEqual(["implement"]);
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.target, `user:${hubot.id}`));
    expect(audit?.details).toEqual({ before: ["triage", "review"], after: ["implement"] });
  });

  it("never edits an admin", async () => {
    expect((await refusal(new UsersService(db).setCapabilities(admin.id, ["review"], admin))).field).toBe("capabilities");
  });
});

describe("UsageService", () => {
  it("pages a user's runs newest first, and sums this month's settled cost", async () => {
    const runs = new RunsRepository(db);
    const thread = await runs.thread("org-x/repo-a", 4242, "issue");
    for (const n of [1, 2, 3]) {
      const run = await runs.createRun({
        threadId: thread.id,
        ticket: Ticket.parse(`t_${String(n).padStart(43, "7")}`),
        mode: "plan",
        harness: "claude",
        model: "claude-sonnet-5-5",
        fastModel: "claude-haiku-4-5",
        context: runContext({ mode: "plan" }),
        route: { mode: "plan", subject: { kind: "issue", number: 4242 }, checkout: { from: "defaultBranch" }, branch: "macaron/4242-work" },
        limitMicros: 1_000_000,
        triggerGithubId: 102,
      });
      await db.update(runsTable).set({ createdAt: new Date(`2026-10-0${String(n)}T00:00:00Z`) }).where(eq(runsTable.id, run.id));
      if (n !== 3) await runs.settle(run.id, 250_000 * n, { repo: "org-x/repo-a", project: "x" }, clock.now());
    }
    const usage = new UsageService(db, clock);
    const first = await usage.page(102, 2, undefined);
    expect(first.runs.map((run) => run.createdAt)).toEqual(["2026-10-03T00:00:00.000Z", "2026-10-02T00:00:00.000Z"]);
    expect(first).toMatchObject({ monthUsd: 0.75, monthRuns: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await usage.page(102, 2, first.nextCursor ?? undefined);
    expect(second.runs.map((run) => run.costUsd)).toEqual([0.25]);
    expect(second.nextCursor).toBeNull();
    expect((await usage.page(999, 10, undefined)).runs).toEqual([]);
  });
});
