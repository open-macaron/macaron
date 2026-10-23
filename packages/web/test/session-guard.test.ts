import type { RouteId } from "$app/types";
import { describe, expect, it } from "vitest";
import { sessionRedirect } from "../src/lib/server/session-guard.ts";
import type { ShellUser } from "../src/lib/session.ts";

const user: ShellUser = { githubLogin: "octocat", name: "The Octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231", isAdmin: false };

describe("sessionRedirect", () => {
  it("sends visitors without a session to sign in, from every app page", () => {
    const routes: RouteId[] = ["/(app)", "/(app)/usage", "/(app)/settings/key", "/(app)/admin/invitations"];
    for (const route of routes) {
      expect(sessionRedirect(route, null), route).toBe("/sign-in");
    }
  });

  it("serves app pages to a signed-in user", () => {
    expect(sessionRedirect("/(app)/usage", user)).toBeUndefined();
  });

  it("sends a signed-in user away from the sign-in page", () => {
    expect(sessionRedirect("/sign-in", user)).toBe("/(app)");
    expect(sessionRedirect("/sign-in", null)).toBeUndefined();
  });

  it("leaves the health check and unknown paths alone", () => {
    expect(sessionRedirect("/healthz", null)).toBeUndefined();
    expect(sessionRedirect(null, null)).toBeUndefined();
  });
});
