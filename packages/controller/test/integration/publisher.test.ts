import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RepoConfig, Ticket } from "@open-macaron/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAndMigrate, type Db } from "../../src/db/db.module.ts";
import { BotIdentity } from "../../src/github/bot-identity.ts";
import { createGitHub } from "../../src/github/github.ts";
import type { RepoRef } from "../../src/github/repo-ref.ts";
import { KnowledgeProposer } from "../../src/knowledge/knowledge-proposer.ts";
import { EvidenceHost } from "../../src/publish/evidence-host.ts";
import { ForkCommitter } from "../../src/publish/fork-committer.ts";
import { Publisher } from "../../src/publish/publisher.ts";
import { ReactionTargets } from "../../src/publish/reaction-targets.ts";
import { type ReactionContent, type ReactionTarget, UpstreamWriter } from "../../src/publish/upstream-writer.ts";
import { RunsRepository } from "../../src/runs/runs.repository.ts";
import { testEnv } from "../support/env.ts";
import { FakeClock } from "../support/fakes.ts";
import { runContext, runResult } from "../support/fixtures.ts";
import { insertPayer, PAYER_ID } from "../support/payer.ts";
import { startPostgres } from "../support/postgres.ts";

const env = testEnv();
const gh = createGitHub("test", "ghp_test_interact_000000000000000000", env.GITHUB_API_VERSION, { throttled: false });
const RUN_URL = "https://github.com/open-macaron/runner/actions/runs/4242";

/** GitHub as the publisher sees it: comments and reactions, kept in memory. */
class RecordingWriter extends UpstreamWriter {
  readonly comments = new Map<number, { readonly number: number; readonly body: string }>();
  readonly reactions: ReactionContent[] = [];
  private next = 1;

  constructor() {
    super(gh);
  }

  override comment(_upstream: RepoRef, number: number, body: string): Promise<number> {
    const id = this.next++;
    this.comments.set(id, { number, body });
    return Promise.resolve(id);
  }

  override commentBody(_upstream: RepoRef, id: number): Promise<string> {
    return Promise.resolve(this.comments.get(id)?.body ?? "");
  }

  override updateComment(_upstream: RepoRef, id: number, body: string): Promise<void> {
    const comment = this.comments.get(id);
    if (comment !== undefined) this.comments.set(id, { ...comment, body });
    return Promise.resolve();
  }

  override react(_upstream: RepoRef, _target: ReactionTarget, content: ReactionContent): Promise<number> {
    this.reactions.push(content);
    return Promise.resolve(this.next++);
  }

  override unreact(): Promise<void> {
    return Promise.resolve();
  }

  bodies(): string[] {
    return [...this.comments.values()].map((comment) => comment.body);
  }
}

class FixedIdentity extends BotIdentity {
  override get identity() {
    return { login: "macaron-bot", id: 7, email: "7+macaron-bot@users.noreply.github.com" };
  }
}

function repoConfig(compact: boolean): RepoConfig {
  return RepoConfig.parse({
    repo: "org-x/repo-a",
    fork: "abc123-repo-a",
    project: "sandbox",
    bots: [],
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
    models: {},
    fastModel: "anthropic/claude-haiku-5.5",
    runsOn: "ubuntu-24.04",
    draftPr: true,
    compact,
    timeoutMinutes: 60,
    budgets: { triage: 0.2, plan: 1, implement: 5, address_review: 2, reproduce: 3, verify: 3, retro: 0.5, review: 0.5 },
    reviewCost: { baseUsd: 0.1, perRuleUsd: 0.04 },
    caps: { perThreadUsd: 20, perRepoMonthUsd: 150, reviewLoops: 6, botReviewLoops: 2, openPrs: 3 },
    environment: { source: "shared", name: "generic", params: {} },
    commands: {},
    contribution: { dco: false, fixCi: false },
  });
}

let container: StartedPostgreSqlContainer;
let db: Db;
let runs: RunsRepository;

beforeAll(async () => {
  container = await startPostgres();
  db = await connectAndMigrate(container.getConnectionUri());
  await insertPayer(db);
  runs = new RunsRepository(db);
});
afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

let issue = 3000;

/** A dispatched reproduce run on a fresh issue, its 👀 placed, and a publisher writing to memory. */
async function dispatched() {
  const number = ++issue;
  const thread = await runs.thread("org-x/repo-a", number, "issue");
  const created = await runs.createRun({
    threadId: thread.id,
    ticket: Ticket.parse(`t_${String(number).padStart(43, "2")}`),
    mode: "reproduce",
    harness: "claude",
    model: "anthropic/claude-sonnet-5.5",
    fastModel: "anthropic/claude-haiku-5.5",
    context: runContext({ mode: "reproduce", number }),
    route: { mode: "reproduce", subject: { kind: "issue", number }, checkout: { from: "defaultBranch" }, branch: `macaron/${String(number)}-work` },
    limitMicros: 1_000_000,
    triggerGithubId: 583231,
    payerId: PAYER_ID,
  });
  await runs.markDispatched(created.id, number);
  const run = await runs.byId(created.id);
  const writer = new RecordingWriter();
  const clock = new FakeClock();
  const bot = new FixedIdentity(gh, gh, gh, env);
  const reactions = new ReactionTargets(runs, writer, clock);
  const committer = new ForkCommitter(gh);
  const publisher = new Publisher(env, runs, committer, writer, bot, reactions, new EvidenceHost(gh, runs), new KnowledgeProposer(env, gh, committer, bot, clock));
  await reactions.start(thread.id, run.loop, { owner: "org-x", repo: "repo-a" }, { kind: "issue", number });
  return { thread: await runs.threadById(thread.id), run, writer, publisher };
}

const answered = runResult({ action: "reply", message: "Reproduced on Linux: the editor crashes on start.", summary: "Reproduced the crash." });
const publishable = (result = answered) => ({ result, changes: undefined, attachments: [], review: undefined });

describe("Publisher in compact mode", () => {
  it("posts nothing when the run starts, then one answer with the run in its footer", async () => {
    const { thread, run, writer, publisher } = await dispatched();
    const config = repoConfig(true);

    await publisher.reportStarted(thread, run, RUN_URL, config);
    expect(writer.comments.size).toBe(0);

    await publisher.publish({ run, thread, config, publishable: publishable(), runUrl: RUN_URL });

    expect(writer.bodies()).toEqual([
      [
        "Reproduced on Linux: the editor crashes on start.",
        "",
        "---",
        `<sub>macaron-bot · loop 1 · \`reproduce\` · runner \`ubuntu-24.04\` · [run ${String(run.ghRunId)}](${RUN_URL})</sub>`,
        "<sub>Spent on this thread: $0.00 ⏳.</sub>",
      ].join("\n"),
    ]);
    expect(writer.reactions).toEqual(["eyes", "+1"]);
  });

  it("answers with the summary when the run has nothing to say", async () => {
    const { thread, run, writer, publisher } = await dispatched();

    await publisher.publish({ run, thread, config: repoConfig(true), publishable: publishable(runResult({ action: "noop", summary: "Nothing to do." })), runUrl: RUN_URL });

    expect(writer.bodies()).toHaveLength(1);
    expect(writer.bodies()[0]).toMatch(/^✅ Nothing to do\.\n\n---\n<sub>macaron-bot · loop 1 /);
  });

  it("updates the answer's spent line once the cost settles", async () => {
    const { thread, run, writer, publisher } = await dispatched();
    await publisher.publish({ run, thread, config: repoConfig(true), publishable: publishable(), runUrl: RUN_URL });

    await runs.settle(run.id, 260_000, { repo: thread.repo, project: "sandbox" }, new Date());
    await publisher.refreshCost(thread, run);

    expect(writer.bodies()).toHaveLength(1);
    expect(writer.bodies()[0]).toContain("<sub>Spent on this thread: $0.26.</sub>");
  });

  it("still says why a run failed, in a comment of its own", async () => {
    const { thread, run, writer, publisher } = await dispatched();

    await publisher.reportFailure({ run, thread, reason: "the run timed out", runUrl: RUN_URL });

    expect(writer.bodies()).toHaveLength(1);
    expect(writer.bodies()[0]).toContain("😕 the run timed out");
    expect(writer.bodies()[0]).toContain("`@macaron-bot retry`");
    expect(writer.reactions).toEqual(["eyes", "confused"]);
  });
});

describe("Publisher with status comments", () => {
  it("posts the status when the run starts, then the answer, and edits the status as it ends", async () => {
    const { thread, run, writer, publisher } = await dispatched();
    const config = repoConfig(false);

    await publisher.reportStarted(thread, run, RUN_URL, config);
    expect(writer.bodies()).toEqual([`**macaron-bot** · loop 1 · \`reproduce\` · [run](${RUN_URL})\n\n⏳ Working on it.\n\n<sub>Spent on this thread: $0.00 ⏳.</sub>`]);

    await publisher.publish({ run, thread, config, publishable: publishable(), runUrl: RUN_URL });

    expect(writer.bodies()).toEqual([
      `**macaron-bot** · loop 1 · \`reproduce\` · [run](${RUN_URL})\n\n✅ Reproduced the crash.\n\n<sub>Spent on this thread: $0.00 ⏳.</sub>`,
      "Reproduced on Linux: the editor crashes on start.",
    ]);
  });
});
