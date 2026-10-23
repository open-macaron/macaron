import { expect, test } from "./fixtures.ts";

test("an admin invites someone: validation, a refusal from the controller, then success", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/invitations");
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("button", { name: "Create invitation" }).click();
  await expect(dialog.getByText("Enter a GitHub login, like octocat.")).toBeVisible();
  await expect(dialog.getByText("Grant at least one capability.")).toBeVisible();

  await dialog.getByLabel("GitHub login").fill("nobody");
  await dialog.getByRole("checkbox", { name: /Triage/ }).click();
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  await expect(dialog.getByText("No GitHub account is called @nobody.")).toBeVisible();

  await dialog.getByLabel("GitHub login").fill("torvalds");
  await dialog.getByRole("checkbox", { name: /Review/ }).click();
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("@torvalds is invited")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row", { name: /torvalds/ });
  await expect(row.getByText("Pending")).toBeVisible();
  await expect(row.getByText("Triage")).toBeVisible();
  await expect(row.getByText("Review")).toBeVisible();
});

test("an admin revokes a pending invitation, after confirming", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/invitations");
  await page.getByRole("button", { name: "Actions for the invitation of @hubot" }).click();
  await page.getByRole("menuitem", { name: "Revoke" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("The invitation of @hubot is revoked")).toBeVisible();
  await expect(page.getByRole("row", { name: /hubot/ }).getByText("Revoked")).toBeVisible();
});

test("an admin changes a user's capabilities; admins have no capabilities to edit", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Actions for @octocat" }).click();
  await expect(page.getByRole("menuitem", { name: "Edit capabilities" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Actions for @defunkt" }).click();
  await page.getByRole("menuitem", { name: "Edit capabilities" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("checkbox", { name: /Plan/ }).click();
  await sheet.getByRole("button", { name: "Save capabilities" }).click();
  await expect(page.getByText("@defunkt's capabilities are updated")).toBeVisible();
  const row = page.getByRole("row", { name: /defunkt/ });
  await expect(row.getByText("Plan")).toBeVisible();
  await expect(row.getByText("Review")).toBeVisible();
});
