import { markdownTable } from "markdown-table";
import type { RuleOutcome, RuleResult } from "./verify.ts";

export interface ReviewMeta {
  /** `owner/name`, for links to the evidence. */
  readonly repo: string;
  /** The commit the review checked (links point at it). */
  readonly headSha: string;
  readonly knowledgeCommit: string | null;
}

/** An inline comment of the review, on a line the change adds. */
export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT";
  readonly body: string;
}

export interface MarkdownOptions {
  /** Makes the reviewer's untrusted text safe to publish (the bot defuses @mentions). */
  readonly clean: (text: string) => string;
  /** Appended to the footer line (the bot: cost and run link). */
  readonly footer?: string;
  /** Only violations and warnings get rows: the others are counted, for a review that would be too long for GitHub. */
  readonly attentionOnly?: boolean;
}

const MAX_INLINE_COMMENTS = 20;
const MAX_EVIDENCE_LINKS = 3;
/** The terminal shows a quote to locate the line, not to read it whole. */
const MAX_QUOTE_CHARS = 120;
/** Why a rule was ignored when nothing about it needs a reader's attention. */
const QUIET_REASONS: ReadonlySet<string> = new Set(["not applicable", "no matching file changed"]);

export const ORDER: readonly RuleOutcome[] = ["violation", "warning", "valid", "ignored"];

/** Inline comments' prefix, and the terminal's labels. */
export const LABEL: Readonly<Record<RuleOutcome, string>> = {
  violation: "❌ violation",
  warning: "⚠️ warning",
  valid: "✅ valid",
  ignored: "➖ ignored",
};

/** Section titles and whether they start open: what needs action is visible, the rest is one click away. */
const GROUP: Readonly<Record<RuleOutcome, { readonly icon: string; readonly title: string; readonly open: boolean }>> = {
  violation: { icon: "❌", title: "Violations", open: true },
  warning: { icon: "⚠️", title: "Warnings", open: true },
  valid: { icon: "✅", title: "Passed", open: false },
  ignored: { icon: "➖", title: "Ignored", open: false },
};

/** Results most severe first. */
export function sortResults(results: readonly RuleResult[]): RuleResult[] {
  return [...results].sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome));
}

export function countResults(results: readonly RuleResult[]): Readonly<Record<RuleOutcome, number>> {
  const count = (outcome: RuleOutcome) => results.filter((result) => result.outcome === outcome).length;
  return { violation: count("violation"), warning: count("warning"), valid: count("valid"), ignored: count("ignored") };
}

/**
 * The GitHub review: one sentence, then the rule checks collapsed, grouped by result (violations and
 * warnings open, passed and ignored closed), so it stays short whatever the number of rules. Rule ids
 * and titles come from owner-approved knowledge; explanations are untrusted and go through `clean`.
 */
export function renderMarkdown(results: readonly RuleResult[], meta: ReviewMeta, options: MarkdownOptions): { body: string; comments: InlineComment[] } {
  const sorted = sortResults(results);
  const of = (outcome: RuleOutcome) => sorted.filter((result) => result.outcome === outcome);
  const oneLine = (text: string) => escapeCell(options.clean(text).replace(/\s+/g, " ").trim());
  const knowledge =
    meta.knowledgeCommit === null
      ? "open-macaron/knowledge"
      : `[open-macaron/knowledge@${meta.knowledgeCommit.slice(0, 7)}](https://github.com/open-macaron/knowledge/tree/${meta.knowledgeCommit})`;

  const lines = [`**macaron-bot review** of \`${meta.headSha.slice(0, 7)}\`: ${headline(countResults(results))}`, ""];
  if (sorted.length > 0) {
    const counts = ORDER.filter((outcome) => of(outcome).length > 0)
      .map((outcome) => `${GROUP[outcome].icon} ${String(of(outcome).length)}`)
      .join(" · ");
    lines.push("<details>", `<summary><b>Rule checks</b> | ${counts}</summary>`, "");
    for (const outcome of ORDER) {
      const group = of(outcome);
      if (group.length === 0) continue;
      if (options.attentionOnly === true && !GROUP[outcome].open) {
        lines.push(`${GROUP[outcome].icon} ${GROUP[outcome].title} (${String(group.length)}): left out, this review would be over GitHub's size limit.`, "");
        continue;
      }
      const rows = group.map((result) => [`${escapeCell(result.title)}<br>\`${result.id}\``, GROUP[outcome].icon, explanationCell(result, meta, oneLine)]);
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
  const footer = options.footer === undefined || options.footer === "" ? "" : ` ${options.footer}`;
  lines.push(
    `<sub>Rules from ${knowledge}, checked one by one on the lines this pull request adds; a violation is only reported with a quote of such a line.${footer}</sub>`,
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

/**
 * For a terminal: a block per rule that needs attention (violations, warnings, and claims the
 * verification dropped), most severe first; the rules that passed or don't apply on one line each,
 * unless `verbose`. Then the counts.
 */
export function renderText(results: readonly RuleResult[], meta: Pick<ReviewMeta, "knowledgeCommit">, options: { readonly verbose?: boolean } = {}): string {
  const sorted = sortResults(results);
  // Ignored for a reason the reader may want to see: the reviewer claimed a violation that didn't hold.
  const notable = (result: RuleResult) => result.outcome !== "valid" && (result.outcome !== "ignored" || !QUIET_REASONS.has(result.reason ?? ""));
  const detailed = options.verbose === true ? sorted : sorted.filter(notable);
  const blocks = detailed.map((result) => {
    const lines = [`${LABEL[result.outcome]}  ${result.id}`, `    ${result.title}`];
    for (const evidence of result.evidence) lines.push(`    ${evidence.file}:${String(evidence.line)}  ${truncate(evidence.quote.replace(/\s+/g, " ").trim(), MAX_QUOTE_CHARS)}`);
    const why = result.outcome === "ignored" && result.reason !== "not applicable" ? result.reason : (result.explanation ?? result.reason);
    if (why !== undefined && why.trim() !== "") lines.push(`    ${why.replace(/\s+/g, " ").trim()}`);
    return lines.join("\n");
  });
  if (options.verbose !== true) {
    const passed = sorted.filter((result) => result.outcome === "valid").map((result) => result.id);
    const quiet = sorted.filter((result) => result.outcome === "ignored" && !notable(result)).length;
    const summary = [
      passed.length > 0 ? `✅ ${String(passed.length)} passed: ${passed.join(", ")}` : undefined,
      quiet > 0 ? `➖ ${String(quiet)} ignored: nothing they check changed (--verbose lists them)` : undefined,
    ].filter((line) => line !== undefined);
    if (summary.length > 0) blocks.push(summary.join("\n"));
  }
  const counts = countResults(results);
  const knowledge = meta.knowledgeCommit === null ? "" : ` · rules from open-macaron/knowledge@${meta.knowledgeCommit.slice(0, 7)}`;
  blocks.push(`❌ ${String(counts.violation)} · ⚠️ ${String(counts.warning)} · ✅ ${String(counts.valid)} · ➖ ${String(counts.ignored)}${knowledge}`);
  return blocks.join("\n\n");
}

/** The one sentence a reader needs. */
function headline(counts: Readonly<Record<RuleOutcome, number>>): string {
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
  if (counts.violation > 0 || counts.warning > 0) {
    const found = [counts.violation > 0 ? plural(counts.violation, "violation") : undefined, counts.warning > 0 ? plural(counts.warning, "warning") : undefined].filter(
      (part) => part !== undefined,
    );
    return `${found.join(" and ")} of the knowledge rules, see the inline comments.`;
  }
  if (counts.valid > 0) return `${counts.valid === 1 ? "the rule that applies passes" : `all ${String(counts.valid)} rules that apply pass`}.`;
  return "no rule could be checked on this change.";
}

/** Why: the reviewer's explanation (or why the rule was ignored), with the evidence for violations. */
function explanationCell(result: RuleResult, meta: ReviewMeta, oneLine: (text: string) => string): string {
  const why = result.outcome === "ignored" && result.reason !== "not applicable" ? escapeCell(result.reason ?? "") : oneLine(result.explanation ?? result.reason ?? "");
  const evidence = result.evidence
    .slice(0, MAX_EVIDENCE_LINKS)
    .map(({ file, line }) => `[\`${escapeCell(file)}:${String(line)}\`](https://github.com/${meta.repo}/blob/${meta.headSha}/${encodeURI(file)}#L${String(line)})`)
    .join(", ");
  return evidence === "" ? why : `${why}${why === "" ? "" : "<br>"}${evidence}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A Markdown table cell on one line. */
function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}
