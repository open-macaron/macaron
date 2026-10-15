import type { PublishedRule, ReviewContext } from "@open-macaron/contracts";
import picomatch from "picomatch";

/** Per review: beyond this many matching rules, the rest are listed as skipped (over the limit). */
export const MAX_RULES_PER_REVIEW = 40;

/**
 * Which rules a pull request is checked against: those whose `appliesTo` (or every file, when
 * absent) matches at least one changed path, minus `exclude`. Deterministic and free: a rule that
 * matches nothing costs no tokens and shows as ignored in the review.
 */
export function selectRules(rules: readonly PublishedRule[], paths: readonly string[]): Pick<ReviewContext, "rules" | "skipped"> {
  const selected: ReviewContext["rules"] = [];
  const skipped: ReviewContext["skipped"] = [];
  for (const rule of rules) {
    const included = rule.appliesTo === null ? () => true : picomatch(rule.appliesTo, { dot: true });
    const excluded = rule.exclude.length === 0 ? () => false : picomatch(rule.exclude, { dot: true });
    const files = paths.filter((path) => included(path) && !excluded(path));
    const headline = { id: rule.id, title: rule.title, severity: rule.severity };
    if (files.length === 0) skipped.push({ ...headline, reason: "no_matching_file" });
    else if (selected.length >= MAX_RULES_PER_REVIEW) skipped.push({ ...headline, reason: "over_limit" });
    else selected.push({ rule, files });
  }
  return { rules: selected, skipped };
}
