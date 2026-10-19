import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Ticket } from "@open-macaron/contracts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { createGitHub } from "../../src/github/github.ts";
import { EvidenceHost } from "../../src/publish/evidence-host.ts";
import type { VettedAttachment } from "../../src/publish/gate.ts";
import { RunsRepository } from "../../src/runs/runs.repository.ts";
import { PNG, runContext } from "../support/fixtures.ts";
import { startPostgres } from "../support/postgres.ts";

const FORK = { owner: "macaron-bot", repo: "abc123-repo-a" };
const FORK_ID = 1_421_946_455;

let container: StartedPostgreSqlContainer;
let db: Db;
let runs: RunsRepository;
const server = setupServer();

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  runs = new RunsRepository(db);
  // After the container: Testcontainers talks HTTP to the container runtime, which must not be intercepted.
  server.listen({ onUnhandledFrame: "bypass" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(async () => {
  server.close();
  await db.$client.end();
  await container.stop();
});

const screenshot: VettedAttachment = {
  id: "editor-env-tab",
  path: "media/editor.png",
  kind: "image",
  caption: "The environment file tab",
  media: { mime: "image/png", ext: "png", kind: "image" },
  bytes: PNG,
};

async function newRun(n: number) {
  const thread = await runs.thread("org-x/repo-a", 2000 + n, "issue");
  const run = await runs.createRun({
    threadId: thread.id,
    ticket: Ticket.parse(`t_${String(n).padStart(43, "1")}`),
    mode: "reproduce",
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
    fastModel: "anthropic/claude-haiku-5.5",
    context: runContext({ mode: "reproduce" }),
    limitMicros: 1_000_000,
  });
  return { thread, run };
}

describe("EvidenceHost", () => {
  const host = () => new EvidenceHost(createGitHub("test", "github_pat_test_push_00000000000000000", "2026-03-10"), runs);

  it("uploads each file once against the bot's fork, as `gh --attach` does, and reuses it when publishing is retried", async () => {
    const uploads: { url: URL; contentType: string | null; size: number }[] = [];
    server.use(
      http.get(`https://api.github.com/repos/${FORK.owner}/${FORK.repo}`, () => HttpResponse.json({ id: FORK_ID })),
      http.post("https://uploads.github.com/user-attachments/assets", async ({ request }) => {
        uploads.push({ url: new URL(request.url), contentType: request.headers.get("content-type"), size: (await request.arrayBuffer()).byteLength });
        return HttpResponse.json({ url: "https://github.com/user-attachments/assets/7e7e7db4-e8c2-40e1-b0a6-650ce281805d" }, { status: 201 });
      }),
    );
    const { thread, run } = await newRun(1);

    const first = await host().publish(FORK, thread, run, [screenshot]);
    const second = await host().publish(FORK, thread, run, [screenshot]);

    expect(first).toEqual(new Map([["editor-env-tab", "https://github.com/user-attachments/assets/7e7e7db4-e8c2-40e1-b0a6-650ce281805d"]]));
    expect(second).toEqual(first);
    expect(uploads).toHaveLength(1);
    expect(Object.fromEntries(uploads[0]?.url.searchParams ?? [])).toEqual({ name: "editor-env-tab.png", content_type: "image/png", repository_id: String(FORK_ID) });
    expect(uploads[0]?.contentType).toBe("image/png");
    expect(uploads[0]?.size).toBe(PNG.byteLength);
  });

  it("does nothing without attachments", async () => {
    const { thread, run } = await newRun(2);
    expect(await host().publish(FORK, thread, run, [])).toEqual(new Map());
  });

  it("fails publishing when GitHub refuses the upload, and refuses an answer that isn't an attachment URL", async () => {
    server.use(
      http.get(`https://api.github.com/repos/${FORK.owner}/${FORK.repo}`, () => HttpResponse.json({ id: FORK_ID })),
      http.post("https://uploads.github.com/user-attachments/assets", () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
    );
    const refused = await newRun(3);
    await expect(host().publish(FORK, refused.thread, refused.run, [screenshot])).rejects.toMatchObject({ status: 404 });

    server.use(http.post("https://uploads.github.com/user-attachments/assets", () => HttpResponse.json({ url: "https://evil.example/x.png" }, { status: 201 })));
    const odd = await newRun(4);
    await expect(host().publish(FORK, odd.thread, odd.run, [screenshot])).rejects.toThrow(/not a GitHub user-attachment URL/);
  });
});
