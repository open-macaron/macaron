import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RepoSlug } from "@open-macaron/contracts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";
import { PullDiffReader } from "../review/pull-diff.ts";
import { RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import type { ThreadState } from "./routes.ts";

/** Reads what routing needs about a thread from GitHub and the ledger. */
@Injectable()
export class ThreadStates {
  private readonly logger = new Logger(ThreadStates.name);

  constructor(
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    private readonly runs: RunsRepository,
    private readonly pulls: PullDiffReader,
  ) {}

  /**
   * The thread as routing sees it. A bot pull request that was merged or closed is forgotten here,
   * once: the thread then has no open pull request, and the next `implement` starts over.
   */
  async read(repo: RepoSlug, thread: ThreadRecord): Promise<ThreadState> {
    const { data: issue } = await this.gh.rest.issues.get({ ...repoRef(thread.repo), issue_number: thread.number });
    let ownPullRequest = thread.prNumber ?? undefined;
    if (ownPullRequest !== undefined && !(await this.pulls.head(repo, ownPullRequest)).open) {
      this.logger.log(`${thread.repo}#${String(thread.number)}: pull request #${String(ownPullRequest)} is closed, forgetting it`);
      await this.runs.updateThread(thread.id, { prNumber: null });
      ownPullRequest = undefined;
    }
    return { number: thread.number, title: issue.title, ownPullRequest, branch: thread.branch ?? undefined, nextLoop: thread.loops + 1 };
  }
}
