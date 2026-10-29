import { fileURLToPath } from "node:url";
import { type ConfigSnapshot, loadConfigTree, RepoSlug } from "@open-macaron/contracts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OnboardingNotice } from "../../src/config/onboarding-notice.ts";
import { createGitHub } from "../../src/github/github.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { fixedConfig } from "../support/forks.ts";

const API = "https://api.github.com/repositories/3003";
const REPO = RepoSlug.parse("axel7083/foobar-tmp-demo");
const FILE = "projects/sandbox/repos/foobar-tmp-demo.yaml";
const MERGE_SHA = "a".repeat(40);
const FORK_URL = "https://github.com/macaron-bot/abc123-foobar-tmp-demo";
const server = setupServer();
const published = testEnv({ CONFIG_URL: "https://open-macaron.github.io/config/", CONFIG_REPO_ID: "3003" });
const gh = createGitHub("test", "token", published.GITHUB_API_VERSION, { throttled: false });
const clock = new FakeClock(new Date("2026-10-29T12:00:00Z"));

let snapshot: ConfigSnapshot;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: "error" });
  snapshot = await loadConfigTree(fileURLToPath(new URL("../../../contracts/test/fixtures/config", import.meta.url)));
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

/** open-macaron/config: the repo file's last commit came from pull request 12, merged at `mergedAt`. */
function configRepo(options: { readonly mergedAt?: string | null; readonly comments?: readonly object[] } = {}) {
  const posted: string[] = [];
  let path: string | null = null;
  server.use(
    http.get(`${API}/commits`, ({ request }) => {
      path = new URL(request.url).searchParams.get("path");
      return HttpResponse.json([{ sha: MERGE_SHA }]);
    }),
    http.get(`${API}/commits/${MERGE_SHA}/pulls`, () => HttpResponse.json([{ number: 12, merged_at: options.mergedAt === undefined ? "2026-10-29T11:00:00Z" : options.mergedAt }])),
    http.get(`${API}/issues/12/comments`, () => HttpResponse.json(options.comments ?? [])),
    http.post(`${API}/issues/12/comments`, async ({ request }) => {
      const body: unknown = await request.json();
      posted.push(typeof body === "object" && body !== null && "body" in body && typeof body.body === "string" ? body.body : "");
      return HttpResponse.json({ id: 1 }, { status: 201 });
    }),
  );
  return { posted, path: () => path };
}

const notice = (env = published) => new OnboardingNotice(gh, env, fixedConfig(env, snapshot), clock);

describe("OnboardingNotice", () => {
  it("links the fork on the pull request that last changed the repository's file", async () => {
    const config = configRepo();

    await notice().onboarded(REPO, FORK_URL);

    expect(config.path()).toBe(FILE);
    expect(config.posted).toHaveLength(1);
    expect(config.posted[0]).toContain(`Onboarded \`${REPO}\``);
    expect(config.posted[0]).toContain(FORK_URL);
    expect(config.posted[0]).toContain("<!-- macaron:onboarding axel7083/foobar-tmp-demo -->");
  });

  it("says why onboarding failed", async () => {
    const config = configRepo();

    await notice().failed(REPO, "axel7083/foobar-tmp-demo isn't public");

    expect(config.posted[0]).toContain("Couldn't onboard");
    expect(config.posted[0]).toContain("isn't public.");
  });

  it("posts once per repository and pull request", async () => {
    const config = configRepo({ comments: [{ user: { login: "macaron-bot" }, body: "…\n\n<!-- macaron:onboarding axel7083/foobar-tmp-demo -->" }] });

    await notice().onboarded(REPO, FORK_URL);

    expect(config.posted).toEqual([]);
  });

  it("ignores a marker someone else wrote", async () => {
    const config = configRepo({ comments: [{ user: { login: "someone" }, body: "<!-- macaron:onboarding axel7083/foobar-tmp-demo -->" }] });

    await notice().onboarded(REPO, FORK_URL);

    expect(config.posted).toHaveLength(1);
  });

  it("leaves old and unmerged pull requests alone: a first deploy finds every fork at once", async () => {
    const old = configRepo({ mergedAt: "2026-10-20T11:00:00Z" });
    await notice().onboarded(REPO, FORK_URL);
    expect(old.posted).toEqual([]);

    const unmerged = configRepo({ mergedAt: null });
    await notice().onboarded(REPO, FORK_URL);
    expect(unmerged.posted).toEqual([]);
  });

  it("posts nothing for a local configuration, and never fails onboarding", async () => {
    await notice(testEnv()).onboarded(REPO, FORK_URL);

    server.use(http.get(`${API}/commits`, () => HttpResponse.json({ message: "Resource not accessible by personal access token" }, { status: 403 })));
    await expect(notice().onboarded(REPO, FORK_URL)).resolves.toBeUndefined();
  });

  it("defuses mentions in a failure's reason", async () => {
    const config = configRepo();

    await notice().failed(REPO, "GitHub refused to fork (403): ask @someone");

    expect(config.posted[0]).not.toMatch(/(^|[^`])@someone/);
  });
});
