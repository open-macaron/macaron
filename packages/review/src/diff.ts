import type { CommitSha } from "@open-macaron/contracts";
import { parsePatch, type StructuredPatch } from "diff";

export interface DiffFile {
  readonly path: string;
  readonly previousPath: string | undefined;
  /** Lines the change adds, by their number in the new version of the file. */
  readonly added: ReadonlyMap<number, string>;
  /** False when there is no patch (binary, too large) or it can't be parsed: nothing in it can be verified. */
  readonly readable: boolean;
}

/** A pull request's changes between two exact commits (the bot reads them from GitHub). */
export interface PullDiff {
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
  readonly files: readonly DiffFile[];
}

/**
 * One file from GitHub's patch (hunks without file headers; jsdiff parses them as is). A patch
 * jsdiff can't parse makes the file unreadable: its evidence can't be verified.
 */
export function diffFileFromPatch(path: string, previousPath: string | undefined, patch: string | undefined): DiffFile {
  const unreadable = { path, previousPath, added: new Map<number, string>(), readable: false };
  if (patch === undefined) return unreadable;
  let hunks: StructuredPatch["hunks"];
  try {
    hunks = parsePatch(patch).flatMap((parsed) => parsed.hunks);
  } catch {
    return unreadable;
  }
  return { path, previousPath, added: addedLines(hunks), readable: true };
}

/** Every file of a `git diff` (with file headers), and the same diff annotated with line numbers. */
export function parseGitDiff(raw: string): { readonly files: DiffFile[]; readonly annotated: string } {
  const files: DiffFile[] = [];
  const sections: string[] = [];
  for (const file of parsePatch(raw)) {
    const path = stripPrefix(file.newFileName) ?? stripPrefix(file.oldFileName);
    if (path === undefined) continue;
    const previous = stripPrefix(file.oldFileName);
    files.push({ path, previousPath: previous === path ? undefined : previous, added: addedLines(file.hunks), readable: file.hunks.length > 0 });
    sections.push(annotate(path, file.hunks));
  }
  return { files, annotated: sections.join("\n\n") };
}

/**
 * The diff with each line's number in the new version of the file, so a reviewer cites exactly what
 * gets verified: `+ 12 | added`, `  13 | context`, `-       | removed`.
 */
export function annotateDiff(raw: string): string {
  return parseGitDiff(raw).annotated;
}

function addedLines(hunks: StructuredPatch["hunks"]): Map<number, string> {
  const added = new Map<number, string>();
  for (const hunk of hunks) {
    let line = hunk.newStart;
    for (const text of hunk.lines) {
      if (text.startsWith("+")) added.set(line++, text.slice(1));
      else if (text.startsWith(" ")) line++;
      // "-" lines and "\ No newline at end of file" don't exist in the new version.
    }
  }
  return added;
}

function annotate(path: string, hunks: StructuredPatch["hunks"]): string {
  const lines = [`### ${path}`];
  for (const hunk of hunks) {
    let line = hunk.newStart;
    lines.push("@@");
    for (const text of hunk.lines) {
      if (text.startsWith("+")) lines.push(`+ ${String(line++).padStart(5)} | ${text.slice(1)}`);
      else if (text.startsWith(" ")) lines.push(`  ${String(line++).padStart(5)} | ${text.slice(1)}`);
      else if (text.startsWith("-")) lines.push(`- ${"".padStart(5)} | ${text.slice(1)}`);
    }
  }
  return lines.join("\n");
}

/** `b/src/a.ts` → `src/a.ts`; `/dev/null` (added or deleted file) → undefined. */
function stripPrefix(name: string | undefined): string | undefined {
  if (name === undefined || name === "/dev/null") return undefined;
  return name.replace(/^[ab]\//, "");
}
