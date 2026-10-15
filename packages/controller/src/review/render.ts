import { markdownTable } from "markdown-table";
import { formatUsd, type UsdMicros } from "../common/money.ts";
import { escapeCell, sanitize } from "../publish/markdown.ts";
import type { RuleOutcome, RuleResult } from "./verify.ts";

export interface ReviewMeta {
  readonly repo: string;
  /** The commit the review checked. */
  readonly headSha: string;
  readonly knowledgeCommit: string | null;
  readonly runUrl: string | null;
  /** null until the run's cost is settled. */
  readonly costMicros: UsdMicros | null;
}

/** An inline comment of the review, on a line the pull request adds. */
export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT";
  readonly body: string;
}

const COST_START = "<!-- macaron:review-cost -->";
const COST_END = "<!-- /macaron:review-cost -->";
const MAX_INLINE_COMMENTS = 20;
const MAX_EVIDENCE_LINKS = 3;

const LABEL: Readonly<Record<RuleOutcome, string>> = {
  violation: "❌ violation",
  warning: "⚠️ warning",
  valid: "✅ valid",
  ignored: "➖ ignored",
};
const ORDER: readonly RuleOutcome[] = ["violation", "warning", "valid", "ignored"];

/**
 * The review's body (one row per rule, most severe first) and its inline comments. Rule ids and
 * titles come from owner-approved knowledge; explanations come from the reviewer and are untrusted:
 * mentions are defused and they never reach a table cell unescaped.
 */
export function renderReview(results: readonly RuleResult[], meta: ReviewMeta): { body: string; comments: InlineComment[] } {
  const sorted = [...results].sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome));
  const count = (outcome: RuleOutcome) => results.filter((result) => result.outcome === outcome).length;
  const knowledge =
    meta.knowledgeCommit === null
      ? "open-macaron/knowledge"
      : `[open-macaron/knowledge@${meta.knowledgeCommit.slice(0, 7)}](https://github.com/open-macaron/knowledge/tree/${meta.knowledgeCommit})`;

  const lines = [
    `**macaron-bot review** of \`${meta.headSha.slice(0, 7)}\` against ${knowledge}: ❌ ${String(count("violation"))} · ⚠️ ${String(count("warning"))} · ✅ ${String(count("valid"))} · ➖ ${String(count("ignored"))}`,
    "",
  ];
  if (sorted.length === 0) {
    lines.push("No rule applies to this repository yet.");
  } else {
    const rows = sorted.map((result) => [
      `\`${result.id}\` ${escapeCell(result.title)}`,
      result.severity,
      LABEL[result.outcome],
      result.outcome === "ignored" ? escapeCell(result.reason ?? "") : evidenceLinks(result, meta),
    ]);
    lines.push(markdownTable([["Rule", "Severity", "Result", "Evidence"], ...rows], { alignDelimiters: false }));
  }

  const explained = sorted.filter((result) => result.explanation !== undefined && result.explanation.trim() !== "");
  if (explained.length > 0) {
    lines.push("", "<details>", "<summary>Details</summary>", "");
    for (const result of explained) lines.push(`- **\`${result.id}\`** (${LABEL[result.outcome]}): ${oneLine(result.explanation ?? "")}`);
    lines.push("", "</details>");
  }
  lines.push(
    "",
    `<sub>Rules are checked one by one on the lines this pull request adds. A violation is only reported with a quote of such a line. ${renderReviewCost(meta.costMicros)}${meta.runUrl === null ? "" : ` · [run](${meta.runUrl})`}</sub>`,
  );

  const comments = sorted
    .filter((result) => result.outcome === "violation" || result.outcome === "warning")
    .flatMap((result) => {
      const [first] = result.evidence;
      if (first === undefined) return [];
      const why = result.explanation === undefined ? "" : `\n\n${oneLine(result.explanation)}`;
      return [{ path: first.file, line: first.line, side: "RIGHT" as const, body: `${LABEL[result.outcome]} **\`${result.id}\`**: ${result.title}${why}` }];
    })
    .slice(0, MAX_INLINE_COMMENTS);

  return { body: lines.join("\n"), comments };
}

/** The cost segment, between markers so settlement can replace it in the published review. */
export function renderReviewCost(costMicros: UsdMicros | null): string {
  return `${COST_START}Cost: ${costMicros === null ? "⏳" : formatUsd(costMicros)}${COST_END}`;
}

/** Replaces the cost segment of a published review body; undefined if the body has none. */
export function withReviewCost(body: string, costMicros: UsdMicros): string | undefined {
  const start = body.indexOf(COST_START);
  const end = body.indexOf(COST_END, start);
  if (start === -1 || end === -1) return undefined;
  return `${body.slice(0, start)}${renderReviewCost(costMicros)}${body.slice(end + COST_END.length)}`;
}

function evidenceLinks(result: RuleResult, meta: ReviewMeta): string {
  return result.evidence
    .slice(0, MAX_EVIDENCE_LINKS)
    .map(({ file, line }) => `[\`${escapeCell(file)}:${String(line)}\`](https://github.com/${meta.repo}/blob/${meta.headSha}/${encodeURI(file)}#L${String(line)})`)
    .join(", ");
}

/** Untrusted text on one line, mentions defused. */
function oneLine(text: string): string {
  return escapeCell(sanitize(text, new Set()).replace(/\s+/g, " ").trim());
}
