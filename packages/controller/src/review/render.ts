import { type InlineComment, renderMarkdown, type ReviewMeta, type RuleResult } from "@open-macaron/review";
import { formatUsd, type UsdMicros } from "../common/money.ts";
import { modelName, sanitize } from "../publish/markdown.ts";

const COST_START = "<!-- macaron:review-cost -->";
const COST_END = "<!-- /macaron:review-cost -->";

/** GitHub refuses a review body over 65,536 characters; the margin leaves room for the settled cost. */
export const MAX_REVIEW_BODY = 65_000;
const ANSWER_SEPARATOR = "\n\n---\n\n";
const ANSWER_CUT = "\n\n… _Cut here: this review would be over GitHub's size limit._";

/**
 * The bot's GitHub review: the shared rendering (@open-macaron/review), with the reviewer's text
 * defused (mentions) and the bot's footer: the cost (⏳ until settled), the loop, the runner, the model, the run,
 * and the command that runs the same review locally, so contributors can check before they push.
 * A full review's `answer` (its verify message, ready to publish) comes first. Over GitHub's limit,
 * the rule checks keep their violations and warnings only, and as a last resort the answer is cut.
 */
export function renderReview(
  results: readonly RuleResult[],
  meta: ReviewMeta & {
    readonly loop: number;
    readonly runner: string | undefined;
    readonly model: string;
    readonly ghRunId: number | null;
    readonly runUrl: string | null;
    readonly costMicros: UsdMicros | null;
    /** The repository's knowledge project, for the local command's `--project`. */
    readonly knowledge: string;
    /** The rule sessions' model, when it isn't the run's. */
    readonly ruleModel?: string | undefined;
  },
  answer?: string,
): { body: string; comments: InlineComment[] } {
  const parts = [renderReviewCost(meta.costMicros), `loop ${String(meta.loop)}`];
  if (meta.runner !== undefined) parts.push(`runner \`${meta.runner}\``);
  parts.push(`model \`${modelName(meta.model)}\``);
  if (meta.ruleModel !== undefined && meta.ruleModel !== meta.model) parts.push(`rules \`${modelName(meta.ruleModel)}\``);
  if (meta.runUrl !== null) parts.push(`[run${meta.ghRunId === null ? "" : ` ${String(meta.ghRunId)}`}](${meta.runUrl})`);
  parts.push(`run it locally: \`npx @open-macaron/review --project ${meta.knowledge}\``);
  const render = (attentionOnly: boolean) => renderMarkdown(results, meta, { clean: (text) => sanitize(text, new Set()), footer: parts.join(" · "), attentionOnly });
  const withAnswer = (rules: string, text = answer) => (text === undefined ? rules : `${text}${ANSWER_SEPARATOR}${rules}`);
  const full = render(false);
  if (withAnswer(full.body).length <= MAX_REVIEW_BODY) return { body: withAnswer(full.body), comments: full.comments };
  const short = render(true);
  if (answer === undefined || withAnswer(short.body).length <= MAX_REVIEW_BODY) return { body: withAnswer(short.body), comments: short.comments };
  const room = Math.max(0, MAX_REVIEW_BODY - short.body.length - ANSWER_SEPARATOR.length - ANSWER_CUT.length);
  return { body: withAnswer(short.body, `${answer.slice(0, room)}${ANSWER_CUT}`), comments: short.comments };
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
