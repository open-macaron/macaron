import { type CommitSha, OwnersFile } from "@open-macaron/contracts";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import { type ChangedFile, decide, type Review, touchedFolders } from "./approval.ts";
import { parseYamlStrict } from "./document.ts";
import { type MergeOutcome, renderStatus, STATUS_MARKER } from "./status.ts";
import type { KnowledgeTree, Problem } from "./tree.ts";

export interface Repository {
  readonly owner: string;
  readonly repo: string;
}

/** The comment author when merge.yml writes with the repository's GITHUB_TOKEN. */
const ACTIONS_BOT = "github-actions[bot]";

/**
 * merge.yml's job: every open PR whose head is `headSha` is evaluated from GitHub data alone
 * (reviews, files, OWNERS.yaml on the default branch) and merged at exactly that commit if owners
 * approved it. `headSha` only says which PRs to look at; it is never evidence of anything.
 */
export async function mergeApproved(octokit: Octokit, repository: Repository, headSha: CommitSha, formatValid: boolean, runUrl: string): Promise<number[]> {
  const { data: repo } = await octokit.rest.repos.get({ ...repository });
  const pulls = await octokit.paginate(octokit.rest.pulls.list, { ...repository, state: "open", per_page: 100 });
  const merged: number[] = [];

  for (const pull of pulls.filter((candidate) => candidate.head.sha === headSha && candidate.base.ref === repo.default_branch)) {
    const files: ChangedFile[] = (await octokit.paginate(octokit.rest.pulls.listFiles, { ...repository, pull_number: pull.number, per_page: 100 })).map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename,
    }));
    const reviews: Review[] = (await octokit.paginate(octokit.rest.pulls.listReviews, { ...repository, pull_number: pull.number, per_page: 100 })).flatMap((review) =>
      review.user === null ? [] : [{ userId: review.user.id, login: review.user.login, state: review.state, commitId: review.commit_id }],
    );
    const ownersOnMain = new Map<string, OwnersFile | undefined>();
    for (const folder of touchedFolders(files).folders) ownersOnMain.set(folder, await ownersAt(octokit, repository, folder, repo.default_branch));

    const decision = decide({ headSha, authorId: pull.user?.id ?? 0, files, reviews, ownersOnMain, formatValid });
    let outcome: MergeOutcome = { kind: "not_ready" };
    if (decision.ready) {
      try {
        // `sha`: GitHub refuses if the head moved since it was evaluated.
        const { data } = await octokit.rest.pulls.merge({ ...repository, pull_number: pull.number, sha: headSha, merge_method: "squash" });
        outcome = { kind: "merged", sha: data.sha };
        merged.push(pull.number);
      } catch (error: unknown) {
        outcome = { kind: "refused", reason: describeHttpError(error) };
        console.error(`merging #${String(pull.number)} failed: ${outcome.reason}`);
      }
    }
    await upsertStatus(octokit, repository, pull.number, renderStatus(decision, outcome, headSha, runUrl));
  }
  return merged;
}

/** `<folder>/OWNERS.yaml` on `ref`, or undefined when it doesn't exist or isn't valid there. */
async function ownersAt(octokit: Octokit, repository: Repository, folder: string, ref: string): Promise<OwnersFile | undefined> {
  let content: unknown;
  try {
    const response = await octokit.rest.repos.getContent({ ...repository, path: `${folder}/OWNERS.yaml`, ref, mediaType: { format: "raw" } });
    content = response.data;
  } catch (error: unknown) {
    if (statusOf(error) === 404) return undefined;
    throw error;
  }
  // The raw media type returns the file's text; validate rather than assume.
  const text = z.string().safeParse(content);
  if (!text.success) return undefined;
  try {
    const parsed = OwnersFile.safeParse(parseYamlStrict(text.data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function upsertStatus(octokit: Octokit, repository: Repository, number: number, body: string): Promise<void> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { ...repository, issue_number: number, per_page: 100 });
  const ours = comments.find((comment) => comment.user?.login === ACTIONS_BOT && (comment.body ?? "").startsWith(STATUS_MARKER));
  if (ours === undefined) await octokit.rest.issues.createComment({ ...repository, issue_number: number, body });
  else if (ours.body !== body) await octokit.rest.issues.updateComment({ ...repository, comment_id: ours.id, body });
}

/** check.yml: each owner's login must still be the login of their account id (renames are caught here). */
export async function checkOwnerLogins(octokit: Octokit, tree: KnowledgeTree): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const folder of tree.folders) {
    for (const owner of folder.owners?.owners ?? []) {
      const path = `${folder.path}/OWNERS.yaml`;
      try {
        const { data } = await octokit.rest.users.getById({ account_id: owner.id });
        if (data.login.toLowerCase() !== owner.login.toLowerCase()) {
          problems.push({ path, message: `account ${String(owner.id)} is now @${data.login}, not @${owner.login}: update the login (the id is what counts)` });
        }
      } catch (error: unknown) {
        if (statusOf(error) !== 404) throw error;
        problems.push({ path, message: `account ${String(owner.id)} (@${owner.login}) doesn't exist` });
      }
    }
  }
  return problems;
}

const HttpError = z.object({ status: z.number(), response: z.object({ data: z.object({ message: z.string() }).optional() }).optional() });

function statusOf(error: unknown): number | undefined {
  const parsed = HttpError.safeParse(error);
  return parsed.success ? parsed.data.status : undefined;
}

/** "HTTP 403: <GitHub's message>", single line and bounded: it ends up in a PR comment. */
function describeHttpError(error: unknown): string {
  const parsed = HttpError.safeParse(error);
  if (!parsed.success) return "unexpected error";
  const message = parsed.data.response?.data?.message.replace(/\s+/g, " ").replace(/`/g, "'").slice(0, 300);
  return message === undefined ? `HTTP ${String(parsed.data.status)}` : `HTTP ${String(parsed.data.status)}: \`${message}\``;
}
