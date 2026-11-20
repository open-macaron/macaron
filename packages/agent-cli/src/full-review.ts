import type { RuleVerdict, RunResult } from "@open-macaron/contracts";

/** Contracts' limits on `summary` and `message`: a note that would cross one is left out. */
const MAX_SUMMARY = 4_096;
const MAX_MESSAGE = 65_536;

const VERIFY_INCOMPLETE = "⚠️ The verification didn't complete: the run's log says why. The rule checks below stand on their own.";
const REVIEW_INCOMPLETE = "_The rule checks didn't complete: `@macaron-bot review` runs them again._";

/**
 * A full review's result.json: the verify session's answer and the rule verdicts, as far as each
 * completed. Both: a review carrying the answer as its message. Only one: that one, saying the other
 * didn't complete. Neither: undefined, the run fails and can be retried.
 */
export function fullReviewResult(answer: RunResult | undefined, verdicts: readonly RuleVerdict[] | undefined, rules: number): RunResult | undefined {
  if (verdicts === undefined) {
    if (answer === undefined) return undefined;
    const message = answer.message === undefined ? undefined : appended(answer.message, REVIEW_INCOMPLETE, MAX_MESSAGE);
    return { ...answer, ...(message === undefined ? {} : { message }), summary: appended(answer.summary, "The rule checks didn't complete.", MAX_SUMMARY, " ") };
  }
  const checked = `Checked ${String(verdicts.length)} of ${String(rules)} rule${rules === 1 ? "" : "s"}.`;
  // Only what a review publishes: an answer's other fields (a commit, an escalation) aren't verify's to give.
  return {
    action: "review",
    review: [...verdicts],
    message: answer?.message ?? VERIFY_INCOMPLETE,
    summary: answer === undefined ? `The verification didn't complete. ${checked}` : appended(answer.summary, checked, MAX_SUMMARY, " "),
    replies: answer?.replies ?? [],
    attachments: answer?.attachments ?? [],
    learnings: answer?.learnings ?? [],
  };
}

function appended(text: string, note: string, max: number, separator = "\n\n"): string {
  const joined = `${text}${separator}${note}`;
  return joined.length <= max ? joined : text;
}
