import type { ReviewContext, RuleSeverity, RuleVerdict } from "@open-macaron/contracts";
import type { DiffFile } from "./diff.ts";

export type RuleOutcome = "valid" | "warning" | "violation" | "ignored";

export interface VerifiedEvidence {
  readonly file: string;
  readonly line: number;
  readonly quote: string;
}

/** One row of the review: what the bot publishes about one rule. */
export interface RuleResult {
  readonly id: string;
  readonly title: string;
  readonly severity: RuleSeverity;
  readonly outcome: RuleOutcome;
  /** Why a rule is ignored. */
  readonly reason: string | undefined;
  /** Only evidence found on lines the pull request adds. */
  readonly evidence: readonly VerifiedEvidence[];
  /** The reviewer's words: untrusted, sanitized before publishing. */
  readonly explanation: string | undefined;
}

export interface ReviewVerification {
  readonly results: readonly RuleResult[];
  /** Malformed or incomplete output (unknown, repeated or missing rule ids): the Gate refuses the run. */
  readonly problems: readonly string[];
}

/** Shortest quote accepted as evidence, unless the whole line is shorter. */
const MIN_QUOTE_CHARS = 8;

const SKIP_REASON: Readonly<Record<ReviewContext["skipped"][number]["reason"], string>> = {
  no_matching_file: "no matching file changed",
  over_limit: "over the per-review rule limit",
};

/**
 * Turns the reviewer's verdicts into the published rows. Deterministic, and the reason the reviewer
 * can't accuse anyone falsely: a violation stands only if each piece of evidence it keeps quotes a
 * line the pull request adds, at that number, in a file the rule applies to. A violation without
 * such evidence is published as ignored, never as a pass. A rule left without a verdict is a problem:
 * a review that doesn't account for every rule it was given isn't published.
 */
export function verifyReview(review: Pick<ReviewContext, "rules" | "skipped">, verdicts: readonly RuleVerdict[], diff: { readonly files: readonly DiffFile[] }): ReviewVerification {
  const problems: string[] = [];
  const selected = new Map(review.rules.map((entry) => [entry.rule.id, entry]));
  const byRule = new Map<string, RuleVerdict>();
  for (const verdict of verdicts) {
    if (!selected.has(verdict.ruleId)) problems.push(`verdict for a rule that wasn't asked: ${verdict.ruleId}`);
    else if (byRule.has(verdict.ruleId)) problems.push(`two verdicts for ${verdict.ruleId}`);
    else byRule.set(verdict.ruleId, verdict);
  }
  const missing = review.rules.map(({ rule }) => rule.id).filter((id) => !byRule.has(id));
  if (missing.length > 0) problems.push(`the review left rules unchecked: ${missing.join(", ")}`);
  const files = new Map(diff.files.map((file) => [file.path, file]));

  const results: RuleResult[] = review.rules.map(({ rule, files: ruleFiles }) => {
    const row = { id: rule.id, title: rule.title, severity: rule.severity };
    const verdict = byRule.get(rule.id);
    if (verdict === undefined) return { ...row, outcome: "ignored", reason: "not checked", evidence: [], explanation: undefined };
    switch (verdict.verdict) {
      case "pass":
        return { ...row, outcome: "valid", reason: undefined, evidence: [], explanation: verdict.explanation };
      case "not_applicable":
        return { ...row, outcome: "ignored", reason: "not applicable", evidence: [], explanation: verdict.explanation };
      case "violation": {
        const allowed = new Set(ruleFiles);
        const evidence = verdict.evidence.filter(({ file, line, quote }) => {
          const added = allowed.has(file) ? files.get(file)?.added.get(line) : undefined;
          if (added === undefined) return false;
          const [text, cited] = [normalize(added), normalize(quote)];
          // A quote must be specific: a few characters would "match" almost any line.
          return cited.length >= Math.min(MIN_QUOTE_CHARS, text.length) && text.includes(cited);
        });
        if (evidence.length === 0) return { ...row, outcome: "ignored", reason: "violation claimed without verifiable evidence", evidence: [], explanation: undefined };
        return { ...row, outcome: rule.severity === "error" ? "violation" : "warning", reason: undefined, evidence, explanation: verdict.explanation };
      }
    }
  });
  const skipped: RuleResult[] = review.skipped.map((entry) => ({
    id: entry.id,
    title: entry.title,
    severity: entry.severity,
    outcome: "ignored",
    reason: SKIP_REASON[entry.reason],
    evidence: [],
    explanation: undefined,
  }));
  return { results: [...results, ...skipped], problems };
}

/** Quotes are compared whitespace-insensitively: models re-indent. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
