import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Changes, type FileChange } from "@open-macaron/contracts";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function succeeds(cwd: string, ...args: string[]): Promise<boolean> {
  try {
    await git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Anonymous checkout of `baseSha` on branch `branch`, with the upstream as `origin` and the bot's
 * fork as `fork`. The base commit is fetched from the fork when the branch already exists there
 * (follow-up loops), from the upstream otherwise.
 */
export async function checkout(work: string, repo: string, fork: string, branch: string, baseSha: string): Promise<void> {
  await run("git", ["init", "--quiet", work]);
  // Files as committed: Git for Windows would otherwise check them out with CRLF, and every file
  // the agent touches would come back with all its lines changed.
  await git(work, "config", "core.autocrlf", "false");
  await git(work, "remote", "add", "origin", `https://github.com/${repo}.git`);
  await git(work, "remote", "add", "fork", `https://github.com/${fork}.git`);
  const fromFork = await succeeds(work, "fetch", "--quiet", "--depth=200", "fork", baseSha);
  if (!fromFork) await git(work, "fetch", "--quiet", "--depth=200", "origin", baseSha);
  await git(work, "checkout", "--quiet", "-B", branch, baseSha);
  // Local identity only: the controller creates the real commit, authored by the bot.
  await git(work, "config", "user.name", "macaron-agent");
  await git(work, "config", "user.email", "macaron-agent@localhost");
}

/** Everything that differs from `baseSha` (commits and working tree alike), as whole files. */
export async function changesSince(work: string, baseSha: string): Promise<Changes> {
  await git(work, "add", "--all");
  const status = await git(work, "diff", "--cached", "--no-renames", "--name-status", "-z", baseSha);
  const fields = status.split("\0").filter((field) => field.length > 0);
  const files: FileChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const kind = fields[index];
    const path = fields[index + 1];
    if (kind === undefined || path === undefined) continue;
    if (kind === "D") {
      files.push({ action: "delete", path });
      continue;
    }
    const mode = (await git(work, "ls-files", "--stage", "--", path)).split(" ")[0];
    if (mode !== "100644" && mode !== "100755") throw new Error(`${path}: mode ${String(mode)} is not supported (symlinks and submodules can't be published)`);
    files.push({ action: "upsert", path, mode, contentBase64: (await readFile(join(work, path))).toString("base64") });
  }
  return Changes.parse({ baseSha, files });
}

/** Files the changes turn from LF to CRLF line endings (new files count as LF), to convert back before publishing. */
export async function crlfIntroduced(work: string, changes: Changes): Promise<string[]> {
  const paths: string[] = [];
  for (const file of changes.files) {
    if (file.action !== "upsert" || !Buffer.from(file.contentBase64, "base64").includes("\r\n")) continue;
    const before = await git(work, "show", `${changes.baseSha}:${file.path}`).catch(() => "");
    if (!before.includes("\r\n")) paths.push(file.path);
  }
  return paths;
}
