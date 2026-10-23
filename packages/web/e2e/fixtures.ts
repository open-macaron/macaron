import { test as base, expect, type Page } from "@playwright/test";
import { PORTS } from "./ports.ts";

const CONTROLLER = `http://127.0.0.1:${String(PORTS.controller)}`;

/** Who the browser is signed in as: the fake controller knows `octocat` (admin) and `defunkt`. */
export type SignedInAs = "octocat" | "defunkt" | undefined;

export const test = base.extend<{ signIn: (as: SignedInAs) => Promise<Page>; renewals: () => Promise<number> }>({
  signIn: async ({ page, context }, use) => {
    await fetch(`${CONTROLLER}/__reset`, { method: "POST" });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await use(async (as) => {
      if (as !== undefined) {
        await context.addCookies([{ name: "__Secure-macaron.session_token", value: as, domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 3600 }]);
      }
      return page;
    });
    // Every test also checks the browser console stayed clean (CSP violations included).
    expect(errors).toEqual([]);
  },
  // Playwright reads a fixture's dependencies from this destructuring: this one has none.
  // eslint-disable-next-line no-empty-pattern
  renewals: async ({}, use) => {
    await use(async () => {
      const response = await fetch(`${CONTROLLER}/__renewals`);
      const body: unknown = await response.json();
      return typeof body === "object" && body !== null && "renewals" in body && typeof body.renewals === "number" ? body.renewals : -1;
    });
  },
});

export { expect };
