import { Learning, RepoSlug, Slug } from "@open-macaron/contracts";
import { z } from "zod";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BotIdentity } from "../../src/github/bot-identity.ts";
import { createGitHub } from "../../src/github/github.ts";
import { KnowledgeProposer } from "../../src/knowledge/knowledge-proposer.ts";
import { ForkCommitter } from "../../src/publish/fork-committer.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext } from "../support/fixtures.ts";
import { testEnv } from "../support/env.ts";

const API = "https://api.github.com";
const UPSTREAM = `${API}/repos/open-macaron/knowledge`;
const FORK = `${API}/repos/macaron-bot/knowledge`;
const MAIN = "1".repeat(40);
const RUN_COMMIT = "2".repeat(40);
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const lesson = {
  id: "podman-desktop/lessons/windows-machines",
  scope: "podman-desktop",
  topic: "Windows machines",
  appliesTo: null,
  sources: ["https://example.org/old"],
  lastVerified: "2026-01-01",
  confidence: "high",
  body: "old",
};
const context = runContext({
  mode: "retro",
  trigger: { kind: "mention", author: "axel7083", url: "https://github.com/axel7083/podman-desktop/issues/40#issuecomment-2", instruction: "remember: …" },
  knowledge: { commit: RUN_COMMIT, lessons: [lesson] },
});
const learning = (overrides: Partial<Record<keyof Learning, unknown>>) =>
  Learning.parse({ scope: "project", topic: "Hyper-V on windows-2025", text: "Hyper-V machines run there.", evidence: "https://github.com/axel7083/podman-desktop/issues/40#issuecomment-1", ...overrides });

interface Recorded {
  refs: string[];
  blobs: string[];
  createdPulls: { head: string; base: string; title: string; body: string }[];
  updatedPulls: { number: number; body: string }[];
}

/** A knowledge repository on GitHub: `existing` paths on main, `changed` since the run's commit, `open` proposals. */
function github(options: { existing?: readonly string[]; changed?: readonly string[]; open?: readonly { ref: string; sha: string; number: number; body: string }[] }): Recorded {
  const recorded: Recorded = { refs: [], blobs: [], createdPulls: [], updatedPulls: [] };
  server.use(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "macaron-bot", id: 7 })),
    http.get(`${UPSTREAM}/branches/main`, () => HttpResponse.json({ name: "main", commit: { sha: MAIN } })),
    http.get(`${UPSTREAM}/compare/:range`, () => HttpResponse.json({ files: (options.changed ?? []).map((filename) => ({ filename })) })),
    http.get(`${UPSTREAM}/contents/*`, ({ params }) => {
      const path = String(params[0]);
      return (options.existing ?? []).includes(path) ? HttpResponse.json({ type: "file", path }) : HttpResponse.json({ message: "Not Found" }, { status: 404 });
    }),
    http.get(`${UPSTREAM}/pulls`, () =>
      HttpResponse.json(
        (options.open ?? []).map((pull) => ({ number: pull.number, html_url: `https://github.com/open-macaron/knowledge/pull/${String(pull.number)}`, body: pull.body, head: { ref: pull.ref, sha: pull.sha, repo: { owner: { login: "macaron-bot" } } } })),
      ),
    ),
    http.post(`${UPSTREAM}/pulls`, async ({ request }) => {
      recorded.createdPulls.push(z.object({ head: z.string(), base: z.string(), title: z.string(), body: z.string() }).parse(await request.json()));
      return HttpResponse.json({ number: 12, html_url: "https://github.com/open-macaron/knowledge/pull/12" }, { status: 201 });
    }),
    http.patch(`${UPSTREAM}/pulls/:number`, async ({ params, request }) => {
      const { body } = z.object({ body: z.string() }).parse(await request.json());
      recorded.updatedPulls.push({ number: Number(params["number"]), body });
      return HttpResponse.json({});
    }),
    http.get(`${FORK}/git/ref/*`, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
    http.post(`${FORK}/merge-upstream`, () => HttpResponse.json({ merge_type: "fast-forward" })),
    http.post(`${FORK}/git/refs`, async ({ request }) => {
      const { ref } = z.object({ ref: z.string() }).parse(await request.json());
      recorded.refs.push(ref);
      return HttpResponse.json({}, { status: 201 });
    }),
    http.get(`${FORK}/git/commits/:sha`, () => HttpResponse.json({ tree: { sha: "t".repeat(40) } })),
    http.post(`${FORK}/git/blobs`, async ({ request }) => {
      const { content } = z.object({ content: z.string() }).parse(await request.json());
      recorded.blobs.push(Buffer.from(content, "base64").toString());
      return HttpResponse.json({ sha: "b".repeat(40) }, { status: 201 });
    }),
    http.post(`${FORK}/git/trees`, () => HttpResponse.json({ sha: "t".repeat(40) }, { status: 201 })),
    http.post(`${FORK}/git/commits`, () => HttpResponse.json({ sha: "c".repeat(40) }, { status: 201 })),
    http.patch(`${FORK}/git/refs/*`, () => HttpResponse.json({})),
  );
  return recorded;
}

async function proposer(): Promise<KnowledgeProposer> {
  const env = testEnv();
  const gh = createGitHub("test", "token", env.GITHUB_API_VERSION, { throttled: false });
  const bot = new BotIdentity(gh, gh, gh, { ...env, GITHUB_BOT_LOGIN: "macaron-bot" });
  await bot.onModuleInit();
  return new KnowledgeProposer(env, gh, new ForkCommitter(gh), bot, new FakeClock(new Date("2026-10-21T10:00:00Z")));
}

const proposal = (learnings: readonly Learning[]) => ({ context, config: { project: Slug.parse("podman-desktop"), repo: RepoSlug.parse("axel7083/podman-desktop") }, learnings, runUrl: "https://github.com/open-macaron/runner/actions/runs/1", runId: "run-1" });

describe("KnowledgeProposer", () => {
  it("opens one pull request per folder, from a new branch at main, with each lesson's file", async () => {
    const recorded = github({});
    const urls = await (await proposer()).propose(proposal([learning({}), learning({ scope: "repo", topic: "Building on Windows" })]));

    expect(urls).toEqual(["https://github.com/open-macaron/knowledge/pull/12", "https://github.com/open-macaron/knowledge/pull/12"]);
    expect(recorded.refs).toEqual(["refs/heads/lessons/projects-podman-desktop/run-1", "refs/heads/lessons/repos-axel7083-podman-desktop/run-1"]);
    expect(recorded.createdPulls.map((pull) => [pull.head, pull.base, pull.title])).toEqual([
      ["macaron-bot:lessons/projects-podman-desktop/run-1", "main", "projects/podman-desktop: Hyper-V on windows-2025"],
      ["macaron-bot:lessons/repos-axel7083-podman-desktop/run-1", "main", "repos/axel7083/podman-desktop: Building on Windows"],
    ]);
    expect(recorded.createdPulls[0]?.body).toContain("- **New** `projects/podman-desktop/lessons/hyper-v-on-windows-2025.md`: Hyper-V on windows-2025");
    // The trigger's author is named without a ping: owners are pinged by merge.yml.
    expect(recorded.createdPulls[0]?.body).toContain("`@axel7083`");
    expect(recorded.blobs[0]).toContain("topic: Hyper-V on windows-2025\n");
  });

  it("adds to the folder's open proposal instead of opening another, and takes a free slug", async () => {
    const recorded = github({
      existing: ["projects/podman-desktop/lessons/hyper-v-on-windows-2025.md"],
      open: [{ ref: "lessons/projects-podman-desktop/run-0", sha: "9".repeat(40), number: 11, body: "Earlier proposal." }],
    });
    const urls = await (await proposer()).propose(proposal([learning({})]));

    expect(urls).toEqual(["https://github.com/open-macaron/knowledge/pull/11"]);
    expect(recorded.refs).toEqual([]);
    expect(recorded.createdPulls).toEqual([]);
    expect(recorded.updatedPulls[0]?.body).toMatch(/^Earlier proposal\.\n\n---\n\n.*`projects\/podman-desktop\/lessons\/hyper-v-on-windows-2025-2\.md`/s);
  });

  it("revises a lesson in place, and warns when it changed on main since the run read it", async () => {
    const recorded = github({ changed: ["projects/podman-desktop/lessons/windows-machines.md"] });
    await (await proposer()).propose(proposal([learning({ updates: lesson.id })]));

    expect(recorded.createdPulls[0]?.body).toContain("- **Revised** `projects/podman-desktop/lessons/windows-machines.md`: Hyper-V on windows-2025 ⚠️ changed on `main` since the run read it (knowledge@2222222)");
  });
});
