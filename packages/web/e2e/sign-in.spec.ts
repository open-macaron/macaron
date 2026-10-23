import { expect, test } from "./fixtures.ts";

test("a visitor without a session lands on sign-in, from any page", async ({ signIn }) => {
  const page = await signIn(undefined);
  for (const path of ["/", "/usage", "/admin/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
});

test("a refused sign-in is explained in our words, never with text from the URL", async ({ signIn }) => {
  const page = await signIn(undefined);
  await page.goto("/sign-in?error=not_invited");
  await expect(page.getByText("This GitHub account isn't invited")).toBeVisible();

  await page.goto("/sign-in?error=%3Cb%3Einjected%3C%2Fb%3E&error_description=Call%20this%20number");
  await expect(page.getByText("Sign-in didn't complete")).toBeVisible();
  await expect(page.getByText("injected")).toHaveCount(0);
  await expect(page.getByText("Call this number")).toHaveCount(0);
});

test("a signed-in user is sent from sign-in to the overview", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/$/);
});

test("the session is renewed by the browser itself, once per visit", async ({ signIn, renewals, context }) => {
  const page = await signIn("defunkt");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect.poll(renewals).toBe(1);
  const session = (await context.cookies()).find((cookie) => cookie.name === "__Secure-macaron.session_token");
  // The fixture's cookie lasted an hour; the renewed one, a week.
  expect(session?.expires).toBeGreaterThan(Date.now() / 1000 + 6 * 86_400);
  expect(session?.httpOnly).toBe(true);
});

test("signing out ends the session and goes back to sign-in", async ({ signIn, context }) => {
  const page = await signIn("octocat");
  await page.goto("/");
  await page.locator("[data-sidebar=footer]").getByText("@octocat").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).some((cookie) => cookie.name === "__Secure-macaron.session_token" && cookie.value !== "")).toBe(false);
});
