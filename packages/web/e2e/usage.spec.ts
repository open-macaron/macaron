import { expect, test } from "./fixtures.ts";

test("the overview shows this month, the user's capabilities and recent runs", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/");
  await expect(page.getByText("$15.00")).toBeVisible();
  await expect(page.getByText("30", { exact: true })).toBeVisible();
  await expect(page.getByText("Review", { exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(6);
  await expect(page.getByText("Settling…")).toBeVisible();
  await expect(page.getByRole("link", { name: "open-macaron/macaron#1200" })).toHaveAttribute("href", "https://github.com/open-macaron/macaron/issues/1200");
});

test("the usage history pages with Load more, in one table", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/usage");
  await expect(page.getByRole("row")).toHaveCount(26);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("row")).toHaveCount(32);
  await expect(page.getByRole("columnheader", { name: "Thread" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("a user who isn't an admin never sees administration", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/");
  await expect(page.getByText("Administration")).toHaveCount(0);
  for (const path of ["/admin/users", "/admin/invitations", "/admin/endpoints"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
});
