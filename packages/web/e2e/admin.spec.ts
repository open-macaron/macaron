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

test("an admin approves an endpoint: validation, a private host refused, then success", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/endpoints");
  await expect(page.getByRole("row", { name: /Anthropic API/ }).getByText("from the deployment's defaults")).toBeVisible();
  await page.getByRole("button", { name: "Approve endpoint" }).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Base URL").fill("http://gateway.example.com");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(dialog.getByText("Name it, in 2 to 60 characters.")).toBeVisible();
  await expect(dialog.getByText("Enter an https:// URL, like https://api.anthropic.com.")).toBeVisible();

  await dialog.getByLabel("Name").fill("Company gateway");
  await dialog.getByLabel("Base URL").fill("https://llm.corp.internal");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(dialog.getByText("This host resolves to a private or reserved address.")).toBeVisible();

  await dialog.getByLabel("Base URL").fill("https://gateway.example.com");
  await dialog.getByLabel(/Pricing note/).fill("Billed by the company.");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Company gateway is approved")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row", { name: /Company gateway/ });
  await expect(row.getByText("https://gateway.example.com")).toBeVisible();
  await expect(row.getByText("Billed by the company.")).toBeVisible();
  await expect(row.getByText("Enabled")).toBeVisible();
  await expect(row.getByText("by @octocat")).toBeVisible();
});

test("an admin disables an endpoint after confirming, then enables it again", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/endpoints");
  const row = page.getByRole("row", { name: /Anthropic API/ });
  await page.getByRole("button", { name: "Actions for Anthropic API" }).click();
  await page.getByRole("menuitem", { name: "Disable" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Anthropic API is disabled")).toBeVisible();
  await expect(row.getByText("Disabled")).toBeVisible();

  await page.getByRole("button", { name: "Actions for Anthropic API" }).click();
  await page.getByRole("menuitem", { name: "Enable" }).click();
  await expect(page.getByText("Anthropic API is enabled")).toBeVisible();
  await expect(row.getByText("Enabled")).toBeVisible();
});

test("an admin sees every user's runs, who asked for each, and a run's details", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/activity");
  await expect(page.getByText("This month: 33 runs, 1 failed, $16.65 settled.")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(26);
  await expect(page.getByRole("row", { name: /open-macaron\/sandbox#8/ }).getByText("No account")).toBeVisible();

  await page.getByRole("button", { name: "Details of the run on open-macaron/sandbox#7" }).click();
  const details = page.getByRole("dialog");
  await expect(details.getByText("the agent ran out of turns before finishing")).toBeVisible();
  await expect(details.getByText("@macaron-bot implement")).toBeVisible();
  await expect(details.getByRole("link", { name: "The workflow run" })).toHaveAttribute("href", "https://github.com/open-macaron/runner/actions/runs/7");
  await expect(details.getByRole("link", { name: "#9" })).toHaveAttribute("href", "https://github.com/open-macaron/sandbox/pull/9");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("row")).toHaveCount(34);
});

test("an admin filters the activity, and the filters stay in the URL", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/activity");
  await page.getByLabel("Status").selectOption("failed");
  await expect(page).toHaveURL(/status=failed/);
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("This month, under these filters: 1 run, 1 failed, $1.25 settled.")).toBeVisible();

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("row")).toHaveCount(26);
});

test("a user's row links to their activity, refusals included", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Actions for @defunkt" }).click();
  await page.getByRole("menuitem", { name: "View activity" }).click();
  await expect(page).toHaveURL(/\/admin\/activity\?user=2$/);
  await expect(page.getByLabel("Asked by")).toHaveValue("2");
  await expect(page.getByText("This month, under these filters: 31 runs")).toBeVisible();

  await page.getByRole("tab", { name: "Refusals" }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("@defunkt may not ask for implement: an admin grants it on the Users page")).toBeVisible();
  await expect(page.getByLabel("Status")).toBeDisabled();
});

test("refusals recorded before reasons were kept say so", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/admin/activity?tab=refusals");
  await expect(page.getByRole("row", { name: /open-macaron\/macaron#12/ }).getByText("Not recorded")).toBeVisible();
});
