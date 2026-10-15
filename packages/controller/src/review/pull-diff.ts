import { Inject, Injectable } from "@nestjs/common";
import { CommitSha, type RepoSlug } from "@open-macaron/contracts";
import { parsePatch } from "diff";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";

export interface DiffFile {
  readonly path: string;
  readonly previousPath: string | undefined;
  /** Lines the pull request adds, by their number in its version of the file. */
  readonly added: ReadonlyMap<number, string>;
  /** False when GitHub gave no patch (binary or too large): nothing in it can be verified. */
  readonly readable: boolean;
}

/** A pull request's changes between two exact commits, as GitHub reports them. */
export interface PullDiff {
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
  readonly files: readonly DiffFile[];
}

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
      files.push(...batch.map((file) => toDiffFile(file.filename, file.previous_filename, file.patch)));
      if (batch.length < PER_PAGE) break;
    }
    return { baseSha, headSha, files };
  }
}

/**
 * Added lines of one file's patch (GitHub sends hunks without file headers; jsdiff parses them as
 * is). A patch jsdiff can't parse makes the file unreadable: its evidence can't be verified.
 */
export function toDiffFile(path: string, previousPath: string | undefined, patch: string | undefined): DiffFile {
  const unreadable = { path, previousPath, added: new Map<number, string>(), readable: false };
  if (patch === undefined) return unreadable;
  let hunks;
  try {
    hunks = parsePatch(patch).flatMap((parsed) => parsed.hunks);
  } catch {
    return unreadable;
  }
  const added = new Map<number, string>();
  for (const hunk of hunks) {
    let line = hunk.newStart;
    for (const text of hunk.lines) {
      if (text.startsWith("+")) added.set(line++, text.slice(1));
      else if (text.startsWith(" ")) line++;
      // "-" lines and "\ No newline at end of file" don't exist in the new version.
    }
  }
  return { path, previousPath, added, readable: true };
}
