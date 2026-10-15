import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePatch } from "diff";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/**
 * The pull request's diff, like its "Files changed": from the merge base of its base commit and the
 * checked-out head. prepare cloned the head shallowly; the base is fetched here, deepening only if
 * the merge base isn't in reach.
 */
export async function pullRequestDiff(work: string, baseSha: string): Promise<string> {
  await git(work, "fetch", "--quiet", "--depth=200", "origin", baseSha);
  let mergeBase: string;
  try {
    mergeBase = (await git(work, "merge-base", baseSha, "HEAD")).trim();
  } catch {
    await git(work, "fetch", "--quiet", "--unshallow", "origin");
    mergeBase = (await git(work, "merge-base", baseSha, "HEAD")).trim();
  }
  return git(work, "diff", "--no-color", "--no-ext-diff", "--unified=3", mergeBase, "HEAD");
}

/**
 * The diff with each line's number in the pull request's version of the file, so the reviewer cites
 * exactly what the controller verifies: `+ 12 | added`, `  13 | context`, `-    | removed`.
 */
export function annotateDiff(raw: string): string {
  const sections: string[] = [];
  for (const file of parsePatch(raw)) {
    const path = (file.newFileName ?? file.oldFileName ?? "").replace(/^b\//, "");
    if (path === "" || path === "/dev/null") continue;
    const lines = [`### ${path}`];
    for (const hunk of file.hunks) {
      let line = hunk.newStart;
      lines.push("@@");
      for (const text of hunk.lines) {
        if (text.startsWith("+")) lines.push(`+ ${String(line++).padStart(5)} | ${text.slice(1)}`);
        else if (text.startsWith(" ")) lines.push(`  ${String(line++).padStart(5)} | ${text.slice(1)}`);
        else if (text.startsWith("-")) lines.push(`- ${"".padStart(5)} | ${text.slice(1)}`);
      }
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}
