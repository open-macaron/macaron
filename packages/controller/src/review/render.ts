import { type InlineComment, renderMarkdown, type ReviewMeta, type RuleResult } from "@open-macaron/review";
import { formatUsd, type UsdMicros } from "../common/money.ts";
import { sanitize } from "../publish/markdown.ts";

const COST_START = "<!-- macaron:review-cost -->";
const COST_END = "<!-- /macaron:review-cost -->";

/**
 * The bot's GitHub review: the shared rendering (@open-macaron/review), with the reviewer's text
 * defused (mentions) and the bot's footer: the cost (⏳ until settled), the loop, the runner and the run.
 */
export function renderReview(
  results: readonly RuleResult[],
  meta: ReviewMeta & {
    readonly loop: number;
    readonly runner: string | undefined;
    readonly ghRunId: number | null;
    readonly runUrl: string | null;
    readonly costMicros: UsdMicros | null;
  },
): { body: string; comments: InlineComment[] } {
  const parts = [renderReviewCost(meta.costMicros), `loop ${String(meta.loop)}`];
  if (meta.runner !== undefined) parts.push(`runner \`${meta.runner}\``);
  if (meta.runUrl !== null) parts.push(`[run${meta.ghRunId === null ? "" : ` ${String(meta.ghRunId)}`}](${meta.runUrl})`);
  return renderMarkdown(results, meta, { clean: (text) => sanitize(text, new Set()), footer: parts.join(" · ") });
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
