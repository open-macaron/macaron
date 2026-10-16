import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Makes the pull request's base and its merge base with the checked-out head available. prepare
 * cloned the head shallowly: the base is fetched, and history deepened only if the merge base isn't
 * in reach. The diff itself is @open-macaron/review's, the same as a local review's.
 */
export async function fetchPullBase(work: string, baseSha: string): Promise<void> {
  await git(work, "fetch", "--quiet", "--depth=200", "origin", baseSha);
  try {
    await git(work, "merge-base", baseSha, "HEAD");
  } catch {
    await git(work, "fetch", "--quiet", "--unshallow", "origin");
  }
}
