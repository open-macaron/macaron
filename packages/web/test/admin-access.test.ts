import { isHttpError } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { assertAdmin } from "../src/lib/server/admin/access.ts";
import type { ShellUser } from "../src/lib/session.ts";

const member: ShellUser = { githubLogin: "octocat", name: "The Octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231", isAdmin: false };
const admin: ShellUser = { ...member, isAdmin: true };

function statusOf(run: () => unknown): number | undefined {
  try {
    run();
  } catch (error) {
    if (isHttpError(error)) return error.status;
    throw error;
  }
  return undefined;
}

describe("assertAdmin", () => {
  it("refuses a request without a session with 401", () => {
    expect(statusOf(() => assertAdmin(null))).toBe(401);
  });

  it("refuses a signed-in user who isn't an admin with 403", () => {
    expect(statusOf(() => assertAdmin(member))).toBe(403);
  });

  it("returns the admin", () => {
    expect(assertAdmin(admin).githubLogin).toBe("octocat");
  });
});
