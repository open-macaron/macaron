import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { type DiffFile, parseGitDiff } from "./diff.ts";

const exec = promisify(execFile);

/** What to review, as in `git diff`: `all` is the net change from the merge base to the working tree. */
export type ScopeMode = "all" | "committed" | "uncommitted";

export interface ScopeOptions {
  /** Any directory inside the worktree. */
  readonly dir: string;
  /** Branch (or commit) to compare to; default: the remote's default branch. */
  readonly base?: string | undefined;
  readonly mode: ScopeMode;
  /** Also review files not yet added to git (as wholly added). */
  readonly includeUntracked: boolean;
}

export interface Scope {
  /** The worktree's root. */
  readonly root: string;
  /** `owner/name` from the `upstream` remote, else `origin`; undefined if neither is on GitHub. */
  readonly repo: string | undefined;
  /** As given or detected (`main`), and the ref it resolved to (`upstream/main`). */
  readonly base: string;
  readonly baseRef: string;
  readonly mergeBase: string;
  /** The reviewed commit, or a description of the working tree. */
  readonly head: string;
  readonly files: readonly DiffFile[];
  readonly annotated: string;
  /** How to read one file's diff (`<path>` placeholder), for prompts. */
  readonly diffCommand: string;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function gitOk(cwd: string, ...args: string[]): Promise<string | undefined> {
  try {
    return (await git(cwd, ...args)).trim();
  } catch {
    return undefined;
  }
}

/** The changes to review in a local worktree, from the merge base with `base`. */
export async function localScope(options: ScopeOptions): Promise<Scope> {
  const root = (await git(options.dir, "rev-parse", "--show-toplevel")).trim();
  const base = options.base ?? (await defaultBranch(root));
  const baseRef = await resolveBase(root, base);
  const mergeBase = (await git(root, "merge-base", baseRef, "HEAD")).trim();
  const head = (await git(root, "rev-parse", "HEAD")).trim();

  // `git diff A B` (committed), `git diff HEAD` (uncommitted), `git diff A` (all: A to the working tree).
  const range = options.mode === "committed" ? [mergeBase, "HEAD"] : options.mode === "uncommitted" ? ["HEAD"] : [mergeBase];
  let raw = await git(root, "diff", "--no-color", "--no-ext-diff", "--unified=3", "--find-renames", ...range);
  if (options.includeUntracked && options.mode !== "committed") raw += await untrackedDiff(root);

  const { files, annotated } = parseGitDiff(raw);
  return {
    root,
    repo: await repoSlug(root),
    base,
    baseRef,
    mergeBase,
    head: options.mode === "committed" ? head : `the working tree (on top of ${head.slice(0, 7)})`,
    files,
    annotated,
    diffCommand: `git diff ${range.join(" ")} -- <path>`,
  };
}

/** `upstream`'s default branch, else `origin`'s, else `main`. */
async function defaultBranch(root: string): Promise<string> {
  for (const remote of ["upstream", "origin"]) {
    const head = await gitOk(root, "symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`);
    if (head !== undefined) return head.replace(`refs/remotes/${remote}/`, "");
  }
  return "main";
}

/** `upstream/<base>`, else `origin/<base>`, else `<base>` itself (a local branch or a commit). */
async function resolveBase(root: string, base: string): Promise<string> {
  for (const candidate of [`upstream/${base}`, `origin/${base}`, base]) {
    if ((await gitOk(root, "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`)) !== undefined) return candidate;
  }
  throw new Error(`can't find ${base} (tried upstream/${base}, origin/${base}, ${base}); fetch it or pass --base`);
}

/** Untracked, non-ignored files as additions (`git diff --no-index` exits 1 when there are differences). */
async function untrackedDiff(root: string): Promise<string> {
  const listed = await git(root, "ls-files", "--others", "--exclude-standard", "-z");
  let raw = "";
  for (const path of listed.split("\0").filter((entry) => entry !== "")) {
    try {
      raw += await git(root, "diff", "--no-color", "--no-index", "--", "/dev/null", path);
    } catch (error: unknown) {
      raw += DiffOutput.parse(error).stdout;
    }
  }
  return raw;
}

const DiffOutput = z.object({ stdout: z.string() });

const GITHUB_REMOTE = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

async function repoSlug(root: string): Promise<string | undefined> {
  for (const remote of ["upstream", "origin"]) {
    const url = await gitOk(root, "remote", "get-url", remote);
    const match = url === undefined ? null : GITHUB_REMOTE.exec(url);
    if (match?.[1] !== undefined && match[2] !== undefined) return `${match[1]}/${match[2]}`;
  }
  return undefined;
}

/** Whether `dir` is inside a git worktree (the CLI's first check). */
export async function isWorktree(dir: string): Promise<boolean> {
  return (await gitOk(dir, "rev-parse", "--is-inside-work-tree")) === "true";
}

