import { Inject, Injectable } from "@nestjs/common";
import { CommitSha, type RepoSlug } from "@open-macaron/contracts";
import { type DiffFile, diffFileFromPatch, type PullDiff } from "@open-macaron/review";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";

/** GitHub stops listing files in a comparison after this many (300 per page, 10 pages). */
const MAX_PAGES = 10;
const PER_PAGE = 300;

/** Reads pull requests for reviews: their exact head, and their diff at that head. */
@Injectable()
export class PullDiffReader {
  constructor(@Inject(GH_INTERACT) private readonly gh: GitHub) {}

  async head(repo: RepoSlug, pull: number): Promise<{ readonly baseSha: CommitSha; readonly headSha: CommitSha; readonly open: boolean }> {
    const { data } = await this.gh.rest.pulls.get({ ...repoRef(repo), pull_number: pull });
    return { baseSha: CommitSha.parse(data.base.sha), headSha: CommitSha.parse(data.head.sha), open: data.state === "open" };
  }

  /** `base...head` (from their merge base, like the pull request's "Files changed"). */
  async read(repo: RepoSlug, baseSha: CommitSha, headSha: CommitSha): Promise<PullDiff> {
    const files: DiffFile[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await this.gh.rest.repos.compareCommitsWithBasehead({ ...repoRef(repo), basehead: `${baseSha}...${headSha}`, per_page: PER_PAGE, page });
      const batch = data.files ?? [];
      files.push(...batch.map((file) => diffFileFromPatch(file.filename, file.previous_filename, file.patch)));
      if (batch.length < PER_PAGE) break;
    }
    return { baseSha, headSha, files };
  }
}
