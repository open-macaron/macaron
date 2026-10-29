import { Inject, Injectable, Logger } from "@nestjs/common";
import { repoKey, type RepoSlug } from "@open-macaron/contracts";
import { z } from "zod";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { GH_ORG, type GitHub } from "../github/github.ts";
import { sanitize } from "../publish/markdown.ts";
import { APP_ENV, type AppEnv } from "./env.ts";
import { RepoConfigService } from "./repo-config.service.ts";

/** Older merges are left alone: on a first deploy, every fork found becomes ready at once. */
const RECENT_MS = 24 * 60 * 60 * 1000;

const Commits = z.array(z.object({ sha: z.string() }));
const Pulls = z.array(z.object({ number: z.int().positive(), merged_at: z.string().nullable() }));
const Comments = z.array(z.object({ body: z.string().optional(), user: z.object({ login: z.string() }).nullable() }));

/**
 * Tells the open-macaron/config pull request that onboarded a repository how it went: the fork's
 * link once it is ready, or why there is none. That pull request is the merged one of the last
 * commit touching the repository's file. Best effort: a comment that can't be posted is logged, and
 * onboarding stands. Posted once per repository and pull request (a marker in the comment), and only
 * for a recent merge. Written with GH_ORG: the org blocks GH_INTERACT, a classic token.
 */
@Injectable()
export class OnboardingNotice {
  private readonly logger = new Logger(OnboardingNotice.name);

  constructor(
    @Inject(GH_ORG) private readonly gh: GitHub,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly config: RepoConfigService,
    private readonly clock: Clock,
  ) {}

  async onboarded(repo: RepoSlug, forkUrl: string): Promise<void> {
    await this.post(
      repo,
      [
        `**Onboarded \`${repo}\`.**`,
        "",
        `- Fork: ${forkUrl}. Actions, wiki, issues and projects are off on it.`,
        "- This project's members can now mention the bot on the repository's issues and pull requests.",
      ].join("\n"),
    );
  }

  async failed(repo: RepoSlug, reason: string): Promise<void> {
    await this.post(
      repo,
      [`**Couldn't onboard \`${repo}\`.**`, "", `${reason}.`, "", "The bot refuses requests on this repository until its fork is ready."].join("\n"),
    );
  }

  private async post(repo: RepoSlug, text: string): Promise<void> {
    const published = this.env.publishedConfig;
    const path = this.config.snapshot.repoFiles.get(repoKey(repo));
    // A local CONFIG_DIR has no pull request to answer.
    if (published === undefined || path === undefined) return;
    try {
      const pull = await this.pullFor(published.repoId, path);
      if (pull === undefined) return;
      const marker = `<!-- macaron:onboarding ${repoKey(repo)} -->`;
      const route = "/repositories/{repository_id}/issues/{issue_number}/comments";
      const params = { repository_id: published.repoId, issue_number: pull };
      const comments = Comments.parse(await this.gh.paginate(`GET ${route}`, { ...params, per_page: 100 }));
      const login = this.env.GITHUB_BOT_LOGIN.toLowerCase();
      if (comments.some((comment) => comment.user?.login.toLowerCase() === login && comment.body?.includes(marker) === true)) return;
      // Sanitized first: it strips `macaron:` markers, which only the controller writes.
      await this.gh.request(`POST ${route}`, { ...params, body: `${sanitize(text, new Set())}\n\n${marker}` });
    } catch (error: unknown) {
      this.logger.warn(`${repo}: no onboarding comment: ${describeError(error)}`);
    }
  }

  /** The recently merged pull request of the last commit touching `path`, if any. */
  private async pullFor(repositoryId: number, path: string): Promise<number | undefined> {
    const commits = await this.gh.request("GET /repositories/{repository_id}/commits", { repository_id: repositoryId, path, per_page: 1 });
    const sha = Commits.parse(unknownData(commits))[0]?.sha;
    if (sha === undefined) return undefined;
    const pulls = unknownData(
      await this.gh.request("GET /repositories/{repository_id}/commits/{commit_sha}/pulls", { repository_id: repositoryId, commit_sha: sha }),
    );
    const recent = (pull: z.infer<typeof Pulls>[number]) => pull.merged_at !== null && this.clock.now().getTime() - Date.parse(pull.merged_at) <= RECENT_MS;
    return Pulls.parse(pulls).find(recent)?.number;
  }
}

/** Routes by repository id aren't in Octokit's types: their data is `any` until validated. */
function unknownData(response: { readonly data: unknown }): unknown {
  return response.data;
}
