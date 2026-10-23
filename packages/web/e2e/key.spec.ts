import { expect, test } from "./fixtures.ts";

const KEY = "sk-ant-api03-e2e-secret-value-1234";
const WRONG = "sk-ant-api03-wrong-secret-value-9999";

test("a user saves a key: validation, a refusal from the endpoint, then success; the key never comes back", async ({ signIn }) => {
  const page = await signIn("octocat");
  const bodies: string[] = [];
  page.on("response", (response) => {
    void response.text().then((text) => bodies.push(text), () => undefined);
  });
  await page.goto("/settings/key");
  await expect(page.getByText("No key yet")).toBeVisible();
  await page.getByRole("button", { name: "Add a key" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Endpoint")).toHaveValue(/[0-9a-f-]{36}/);

  await dialog.getByLabel("API key").fill("short");
  await dialog.getByRole("button", { name: "Check and save" }).click();
  await expect(dialog.getByText("Paste the whole key: this is too short.")).toBeVisible();

  await dialog.getByLabel("API key").fill(WRONG);
  await dialog.getByRole("button", { name: "Check and save" }).click();
  await expect(dialog.getByText("Anthropic API refused this key (HTTP 401).", { exact: false })).toBeVisible();

  await dialog.getByLabel("API key").fill(KEY);
  await dialog.getByRole("button", { name: "Check and save" }).click();
  await expect(page.getByText("Your key for Anthropic API is saved")).toBeVisible();
  await expect(page.getByText("Anthropic API doesn't list every model the bot uses")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("••••••••1234")).toBeVisible();
  await expect(page.getByText("Valid", { exact: true })).toBeVisible();

  const history = page.getByRole("table");
  await expect(history.getByRole("row", { name: /Saved/ })).toContainText("…1234");
  await expect(history.getByRole("row", { name: /Refused by the endpoint/ })).toContainText("…9999");

  // Neither key ever travels back to the browser: not in the form's answers, not in the page.
  await page.reload();
  await expect(page.getByText("••••••••1234")).toBeVisible();
  expect(bodies.join("\n")).not.toContain(KEY);
  expect(bodies.join("\n")).not.toContain(WRONG);
  expect(await page.content()).not.toContain(KEY);
});

test("a user deletes their key after confirming", async ({ signIn }) => {
  const page = await signIn("octocat");
  await page.goto("/settings/key");
  await page.getByRole("button", { name: "Add a key" }).click();
  await page.getByRole("dialog").getByLabel("API key").fill(KEY);
  await page.getByRole("dialog").getByRole("button", { name: "Check and save" }).click();
  await expect(page.getByText("••••••••1234")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog").getByText("Delete your key ending in 1234?")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Your key is deleted")).toBeVisible();
  await expect(page.getByText("No key yet")).toBeVisible();
  await expect(page.getByRole("table").getByRole("row", { name: /Deleted/ })).toContainText("…1234");
});

test("a sign-in older than 10 minutes must be renewed before saving a key", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/settings/key");
  await page.getByRole("button", { name: "Add a key" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Confirm it's you")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Sign in again" })).toBeVisible();
  await expect(dialog.getByLabel("API key")).toHaveCount(0);
});
