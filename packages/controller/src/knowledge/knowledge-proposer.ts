import { Inject, Injectable } from "@nestjs/common";
import { Changes, type Learning, type RepoConfig, type RunContext } from "@open-macaron/contracts";
import { Clock } from "../common/clock.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { GH_ORG, type GitHub } from "../github/github.ts";
import { httpStatus, repoRef, type RepoRef } from "../github/repo-ref.ts";
import { ForkCommitter } from "../publish/fork-committer.ts";
import { sanitize } from "../publish/markdown.ts";
import { lessonFile, type LessonFile, slugOf } from "./lesson-files.ts";

export interface Proposal {
  readonly context: RunContext;
  readonly config: Pick<RepoConfig, "project" | "repo">;
  readonly learnings: readonly Learning[];
  /** The run's Actions URL, linked from the pull request. */
  readonly runUrl: string | null;
  /** Unique per loop: names the branch of a new pull request. */
  readonly runId: string;
}

/**
 * Turns a `remember:` run's learnings into pull requests on open-macaron/knowledge, one per owned
 * folder, from the bot's fork: the folder's owners approve, merge.yml merges. A folder that already
 * has an open proposal gets a new commit on it rather than a second pull request. Branches are only
 * ever fast-forwarded (ForkCommitter); a new one starts at upstream `main`, so it is never behind on
 * `.github/workflows/`, which the merge workflow can't merge.
 *
 * Tokens: GH_PUSH writes the fork (ForkCommitter); GH_ORG, which may act on open-macaron/knowledge,
 * opens and updates the pull requests: the org blocks the classic GH_INTERACT.
 */
@Injectable()
export class KnowledgeProposer {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GH_ORG) private readonly gh: GitHub,
    private readonly committer: ForkCommitter,
    private readonly bot: BotIdentity,
    private readonly clock: Clock,
  ) {}

  /** The pull requests' URLs, one per folder the learnings touch. */
  async propose(proposal: Proposal): Promise<string[]> {
    const upstream = repoRef(this.env.KNOWLEDGE_REPO);
    const fork: RepoRef = { owner: this.bot.identity.login, repo: upstream.repo };
    const { data: main } = await this.gh.rest.repos.getBranch({ ...upstream, branch: "main" });
    const files = await this.files(upstream, main.commit.sha, proposal);
    const changedSinceRun = await this.changedSince(upstream, proposal.context.knowledge.commit, main.commit.sha);

    const urls: string[] = [];
    for (const folder of [...new Set(files.map((file) => file.folder))]) {
      const inFolder = files.filter((file) => file.folder === folder);
      urls.push(await this.proposeFolder(upstream, fork, main.commit.sha, folder, inFolder, changedSinceRun, proposal));
    }
    return urls;
  }

  private async proposeFolder(
    upstream: RepoRef,
    fork: RepoRef,
    mainSha: string,
    folder: string,
    files: readonly LessonFile[],
    changedSinceRun: ReadonlySet<string> | undefined,
    proposal: Proposal,
  ): Promise<string> {
    const prefix = `lessons/${folder.replaceAll("/", "-")}/`;
    const open = await this.openProposal(upstream, fork, prefix);
    const branch = open?.branch ?? `${prefix}${proposal.runId}`;
    const head = open?.head ?? (await this.committer.ensureBranch(fork, branch, mainSha, "main"));
    const changes = Changes.parse({
      baseSha: head,
      files: files.map((file) => ({ action: "upsert", path: file.path, mode: "100644", contentBase64: Buffer.from(file.content).toString("base64") })),
    });
    await this.committer.commit(fork, branch, head, changes, commitMessage(files), this.bot.identity);

    const section = describe(files, proposal, changedSinceRun);
    if (open !== undefined) {
      await this.gh.rest.pulls.update({ ...upstream, pull_number: open.number, body: `${open.body}\n\n---\n\n${section}` });
      return open.url;
    }
    const title = files.length === 1 && files[0] !== undefined ? `${folder}: ${files[0].topic}` : `${folder}: ${String(files.length)} lessons`;
    const { data } = await this.gh.rest.pulls.create({ ...upstream, head: `${fork.owner}:${branch}`, base: "main", title: title.slice(0, 250), body: section });
    return data.html_url;
  }

  /** Every learning's file; a new lesson takes a slug no lesson on `main` (or in this proposal) has. */
  private async files(upstream: RepoRef, mainSha: string, proposal: Proposal): Promise<LessonFile[]> {
    const triggerUrl = proposal.context.trigger.url;
    const today = this.clock.now().toISOString().slice(0, 10);
    const taken = new Set<string>();
    const files: LessonFile[] = [];
    for (const learning of proposal.learnings) {
      let file = lessonFile({ learning, lessons: proposal.context.knowledge.lessons, config: proposal.config, triggerUrl, today, slug: slugOf(learning.topic) });
      for (let attempt = 2; file.revises === undefined && (taken.has(file.path) || (await this.exists(upstream, mainSha, file.path))); attempt++) {
        file = lessonFile({ learning, lessons: [], config: proposal.config, triggerUrl, today, slug: `${slugOf(learning.topic).slice(0, 60)}-${String(attempt)}` });
      }
      taken.add(file.path);
      files.push(file);
    }
    return files;
  }

  private async exists(upstream: RepoRef, ref: string, path: string): Promise<boolean> {
    try {
      await this.gh.rest.repos.getContent({ ...upstream, path, ref });
      return true;
    } catch (error: unknown) {
      if (httpStatus(error) === 404) return false;
      throw error;
    }
  }

  /** Files changed on `main` since the knowledge commit the run read; undefined when unknown. */
  private async changedSince(upstream: RepoRef, runCommit: string | null, mainSha: string): Promise<ReadonlySet<string> | undefined> {
    if (runCommit === null || runCommit === mainSha) return runCommit === null ? undefined : new Set();
    const { data } = await this.gh.rest.repos.compareCommits({ ...upstream, base: runCommit, head: mainSha });
    return new Set((data.files ?? []).map((file) => file.filename));
  }

  /** The bot's open proposal for a folder, if any. */
  private async openProposal(upstream: RepoRef, fork: RepoRef, prefix: string): Promise<{ branch: string; head: string; number: number; url: string; body: string } | undefined> {
    const pulls = await this.gh.paginate(this.gh.rest.pulls.list, { ...upstream, state: "open", per_page: 100 });
    const pull = pulls.find((candidate) => candidate.head.repo.owner.login === fork.owner && candidate.head.ref.startsWith(prefix));
    return pull === undefined ? undefined : { branch: pull.head.ref, head: pull.head.sha, number: pull.number, url: pull.html_url, body: pull.body ?? "" };
  }
}

function commitMessage(files: readonly LessonFile[]): string {
  return files.map((file) => `${file.revises === undefined ? "lesson" : "revise lesson"}: ${file.topic}`).join("\n");
}

/** What a pull request says about one proposal. Mentions are defused: owners are pinged by merge.yml. */
function describe(files: readonly LessonFile[], proposal: Proposal, changedSinceRun: ReadonlySet<string> | undefined): string {
  const { trigger, knowledge } = proposal.context;
  const lines = files.map((file) => {
    const stale = file.revises !== undefined && changedSinceRun?.has(file.path) === true ? ` ⚠️ changed on \`main\` since the run read it (knowledge@${(knowledge.commit ?? "").slice(0, 7)}): keep those changes` : "";
    return `- ${file.revises === undefined ? "**New**" : "**Revised**"} \`${file.path}\`: ${file.topic}${stale}`;
  });
  const run = proposal.runUrl === null ? "" : ` ([run](${proposal.runUrl}))`;
  return sanitize(
    [`Proposed by macaron-bot after \`remember:\` from \`@${trigger.author}\` on ${trigger.url}${run}.`, "", ...lines, "", "The folder's owners decide: approve to merge, or comment."].join("\n"),
    new Set(),
  );
}
