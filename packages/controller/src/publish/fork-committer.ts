import { Inject, Injectable } from "@nestjs/common";
import type { Changes } from "@open-macaron/contracts";
import { GH_PUSH, type GitHub } from "../github/github.ts";
import { httpStatus, type RepoRef } from "../github/repo-ref.ts";
import type { Identity } from "../github/bot-identity.ts";
import { FORBIDDEN_PATH } from "./gate.ts";

/** A commit would have written a path the bot must never change (`.github/`, `.git/`…). */
export class ForbiddenPath extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`refusing to commit ${paths.join(", ")}: the bot never writes these paths`);
    this.name = "ForbiddenPath";
  }
}

export class BranchMoved extends Error {
  constructor(readonly branch: string) {
    super(`branch ${branch} moved since the run started; refusing to rewrite it`);
    this.name = "BranchMoved";
  }
}

/**
 * Writes to the bot's forks through the Git Data API, with GH_PUSH only. No git binary and no
 * clone on the VPS; every update is fast-forward only, so history is never rewritten.
 */
@Injectable()
export class ForkCommitter {
  constructor(@Inject(GH_PUSH) private readonly gh: GitHub) {}

  /**
   * Head of `branch` on the fork, creating the branch at `baseSha` if it does not exist. The fork's
   * `syncFrom` branch is synced from upstream first, so the fork never lags. Carrying upstream's
   * commits that touch `.github/workflows/` (sync or new ref) needs GH_PUSH's Workflows permission;
   * Actions stay disabled on the forks, and `commit` never writes such a path itself.
   */
  async ensureBranch(fork: RepoRef, branch: string, baseSha: string, syncFrom: string): Promise<string> {
    const head = await this.head(fork, branch);
    if (head !== undefined) return head;
    await this.gh.rest.repos.mergeUpstream({ ...fork, branch: syncFrom });
    await this.gh.rest.git.createRef({ ...fork, ref: `refs/heads/${branch}`, sha: baseSha });
    return baseSha;
  }

  async head(fork: RepoRef, branch: string): Promise<string | undefined> {
    try {
      const { data } = await this.gh.rest.git.getRef({ ...fork, ref: `heads/${branch}` });
      return data.object.sha;
    } catch (error: unknown) {
      if (httpStatus(error) === 404) return undefined;
      throw error;
    }
  }

  /** One commit with all `changes` on top of `expectedHead`. Throws BranchMoved if someone pushed meanwhile. */
  async commit(fork: RepoRef, branch: string, expectedHead: string, changes: Changes, message: string, author: Identity): Promise<string> {
    // GH_PUSH may write workflow files, to carry upstream's own: this commit never adds any. The Gate
    // already refused them in the run's result; this holds whatever the caller.
    const forbidden = changes.files.map((file) => file.path).filter((path) => FORBIDDEN_PATH.test(path));
    if (forbidden.length > 0) throw new ForbiddenPath(forbidden);
    const { data: parent } = await this.gh.rest.git.getCommit({ ...fork, commit_sha: expectedHead });

    const tree: { path: string; mode: "100644" | "100755"; type: "blob"; sha: string | null }[] = [];
    for (const file of changes.files) {
      if (file.action === "delete") {
        tree.push({ path: file.path, mode: "100644", type: "blob", sha: null });
      } else {
        const { data: blob } = await this.gh.rest.git.createBlob({ ...fork, content: file.contentBase64, encoding: "base64" });
        tree.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
      }
    }
    const { data: newTree } = await this.gh.rest.git.createTree({ ...fork, base_tree: parent.tree.sha, tree });
    const { data: commit } = await this.gh.rest.git.createCommit({
      ...fork,
      message,
      tree: newTree.sha,
      parents: [expectedHead],
      author: { name: author.login, email: author.email },
    });
    try {
      await this.gh.rest.git.updateRef({ ...fork, ref: `heads/${branch}`, sha: commit.sha, force: false });
    } catch (error: unknown) {
      if (httpStatus(error) === 422) throw new BranchMoved(branch);
      throw error;
    }
    return commit.sha;
  }
}
