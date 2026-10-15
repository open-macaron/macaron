import type { Decision, FolderStatus } from "./approval.ts";

/** Marks the one comment merge.yml keeps up to date on each PR. */
export const STATUS_MARKER = "<!-- knowledge-merge-status -->";

export type MergeOutcome =
  | { readonly kind: "merged"; readonly sha: string }
  | { readonly kind: "refused"; readonly reason: string }
  /** Approved, but the branch lacks workflow changes made on the default branch: GitHub forbids the merge. */
  | { readonly kind: "outdated" }
  | { readonly kind: "not_ready" };

/**
 * The PR's status comment. Only trusted strings reach it: folder paths that exist on the default
 * branch, logins from OWNERS.yaml on that branch or from GitHub's API, and our run's URL.
 */
export function renderStatus(decision: Decision, outcome: MergeOutcome, headSha: string, runUrl: string): string {
  const lines = [STATUS_MARKER, `**Merge status** for \`${headSha.slice(0, 7)}\``, ""];
  if (decision.folders.length > 0) {
    lines.push("| Folder | Status |", "| - | - |", ...decision.folders.map((status) => `| \`${status.folder}\` | ${describe(status)} |`), "");
  }
  if (!decision.formatValid) lines.push(`- ❌ The format check failed for this commit: see the [run](${runUrl}).`);
  if (decision.unownedFiles > 0) {
    lines.push(`- ⚠️ ${String(decision.unownedFiles)} path${decision.unownedFiles === 1 ? " is" : "s are"} outside folders with an \`OWNERS.yaml\` on the default branch: the platform team merges this PR by hand.`);
  }
  switch (outcome.kind) {
    case "merged":
      lines.push(`- ✅ Merged as \`${outcome.sha.slice(0, 7)}\`.`);
      break;
    case "refused":
      lines.push(`- ❌ Approved, but GitHub refused the merge: ${outcome.reason}`);
      break;
    case "outdated":
      lines.push(
        "- ⚠️ Approved, but the branch is behind the default branch, which changed `.github/workflows/` since: GitHub doesn't let a workflow merge it. Recreate the branch from the default branch with the same changes (a maintainer can also use *Update branch*); if the content changes, it needs a new approval.",
      );
      break;
    case "not_ready":
      break;
  }
  lines.push("", `<sub>Updated by merge.yml ([run](${runUrl})). Only owners' approvals count; a push that changes the content dismisses them.</sub>`);
  return lines.join("\n");
}

function describe(status: FolderStatus): string {
  const mentions = (logins: readonly string[]) => logins.map((login) => `@${login}`).join(", ");
  switch (status.state) {
    case "approved":
      return `✅ approved by ${mentions(status.by)}`;
    case "changes_requested":
      return `❌ changes requested by ${mentions(status.by)}`;
    case "waiting":
      return `⏳ waiting for an owner: ${mentions(status.owners)}`;
  }
}
