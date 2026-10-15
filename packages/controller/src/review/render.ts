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

/** Inline comments' prefix. */
const LABEL: Readonly<Record<RuleOutcome, string>> = {
  violation: "❌ violation",
  warning: "⚠️ warning",
  valid: "✅ valid",
  ignored: "➖ ignored",
};
const ORDER: readonly RuleOutcome[] = ["violation", "warning", "valid", "ignored"];

/** Section titles and whether they start open: what needs action is visible, the rest is one click away. */
const GROUP: Readonly<Record<RuleOutcome, { readonly icon: string; readonly title: string; readonly open: boolean }>> = {
  violation: { icon: "❌", title: "Violations", open: true },
  warning: { icon: "⚠️", title: "Warnings", open: true },
  valid: { icon: "✅", title: "Passed", open: false },
  ignored: { icon: "➖", title: "Ignored", open: false },
};

/**
 * The review's body: one sentence, then the rule checks collapsed, grouped by result (violations and
 * warnings open, passed and ignored closed), so it stays short whatever the number of rules. Rule ids
 * and titles come from owner-approved knowledge; explanations come from the reviewer and are
 * untrusted: mentions are defused and they never reach a table cell unescaped.
 */
export function renderReview(results: readonly RuleResult[], meta: ReviewMeta): { body: string; comments: InlineComment[] } {
  const sorted = [...results].sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome));
  const of = (outcome: RuleOutcome) => sorted.filter((result) => result.outcome === outcome);
  const knowledge =
    meta.knowledgeCommit === null
      ? "open-macaron/knowledge"
      : `[open-macaron/knowledge@${meta.knowledgeCommit.slice(0, 7)}](https://github.com/open-macaron/knowledge/tree/${meta.knowledgeCommit})`;

  const lines = [`**macaron-bot review** of \`${meta.headSha.slice(0, 7)}\`: ${headline(of("violation").length, of("warning").length, of("valid").length)}`, ""];
  if (sorted.length > 0) {
    const counts = ORDER.filter((outcome) => of(outcome).length > 0)
      .map((outcome) => `${GROUP[outcome].icon} ${String(of(outcome).length)}`)
      .join(" · ");
    lines.push("<details>", `<summary><b>Rule checks</b> | ${counts}</summary>`, "");
    for (const outcome of ORDER) {
      const group = of(outcome);
      if (group.length === 0) continue;
      const rows = group.map((result) => [`${escapeCell(result.title)}<br>\`${result.id}\``, GROUP[outcome].icon, explanationCell(result, meta)]);
      lines.push(
        GROUP[outcome].open ? "<details open>" : "<details>",
        `<summary>${GROUP[outcome].icon} ${GROUP[outcome].title} (${String(group.length)})</summary>`,
        "",
        markdownTable([["Rule", "Status", "Explanation"], ...rows], { alignDelimiters: false }),
        "",
        "</details>",
        "",
      );
    }
    lines.push("</details>", "");
  }
  lines.push(
    `<sub>Rules from ${knowledge}, checked one by one on the lines this pull request adds; a violation is only reported with a quote of such a line. ${renderReviewCost(meta.costMicros)}${meta.runUrl === null ? "" : ` · [run](${meta.runUrl})`}</sub>`,
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

/** The one sentence a reader needs. */
function headline(violations: number, warnings: number, passed: number): string {
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
  if (violations > 0 || warnings > 0) {
    const found = [violations > 0 ? plural(violations, "violation") : undefined, warnings > 0 ? plural(warnings, "warning") : undefined].filter((part) => part !== undefined);
    return `${found.join(" and ")} of the knowledge rules, see the inline comments.`;
  }
  if (passed > 0) return `${passed === 1 ? "the rule that applies passes" : `all ${String(passed)} rules that apply pass`}.`;
  return "no rule could be checked on this change.";
}

/** Why: the reviewer's explanation (or why the rule was ignored), with the evidence for violations. */
function explanationCell(result: RuleResult, meta: ReviewMeta): string {
  const why = result.outcome === "ignored" && result.reason !== "not applicable" ? escapeCell(result.reason ?? "") : oneLine(result.explanation ?? result.reason ?? "");
  const evidence = evidenceLinks(result, meta);
  return evidence === "" ? why : `${why}${why === "" ? "" : "<br>"}${evidence}`;
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
