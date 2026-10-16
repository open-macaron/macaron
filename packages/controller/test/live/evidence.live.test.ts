import { describe, expect, it } from "vitest";
import { createGitHub } from "../../src/github/github.ts";
import { uploadUserAttachment } from "../../src/publish/evidence-host.ts";
import { PNG } from "../support/fixtures.ts";
import { liveEnv } from "../support/live.ts";

const env = liveEnv();

/** Uploads a 1×1 PNG as macaron-bot against one of its forks. Unreferenced, it stays private to the bot. */
describe.skipIf(env === undefined)("GitHub user-attachments (live)", () => {
  it("accepts the bot's push token against its own fork", { timeout: 60_000 }, async () => {
    if (env === undefined) return;
    const gh = createGitHub("live", env.GH_PUSH, env.GITHUB_API_VERSION);
    const forks = await gh.paginate(gh.rest.repos.listForAuthenticatedUser, { type: "owner", per_page: 100 });
    const fork = forks.find((repo) => repo.fork);
    if (fork === undefined) throw new Error("the bot has no fork to upload against");

    const url = await uploadUserAttachment(gh, fork.id, "live-test.png", "image/png", PNG);
    expect(url).toMatch(/^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}$/);
  });
});
