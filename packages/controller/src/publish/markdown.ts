import type { Mode } from "@open-macaron/contracts";
import { markdownTable } from "markdown-table";
import { formatUsd, type UsdMicros } from "../common/money.ts";
import { applyEdits, htmlRanges, proseRanges } from "./markdown-ast.ts";

/** Shown while OpenRouter hasn't reported a loop's final cost yet. */
const SETTLING = "⏳";

/** GitHub rejects bodies over 65 536 characters; keep room for our own sections. */
export const MAX_BODY_CHARS = 60_000;

const COST_START = "<!-- macaron:cost:start -->";
const COST_END = "<!-- macaron:cost:end -->";
/** A GitHub @mention: user or org/team, preceded by start or a non-word character. */
const MENTION = /(?<![\w@/`])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9_.-]+)?)/g;

/**
 * Makes untrusted Markdown safe to post, editing the source in place (formatting preserved):
 * - removes raw HTML claiming to be ours (`<!-- macaron:… -->`), so our sections can't be forged;
 * - turns @mentions of people outside `allowedMentions` into code spans (no notification);
 *   only prose is touched — code, links and autolinked emails are left as they are;
 * - truncates to MAX_BODY_CHARS.
 */
export function sanitize(body: string, allowedMentions: ReadonlySet<string>): string {
  const allowed = new Set([...allowedMentions].map((login) => login.toLowerCase()));
  const edits = htmlRanges(body)
    .filter((range) => /^<!--\s*macaron:/.test(body.slice(range.start, range.end)))
    .map((range) => ({ ...range, text: "" }));
  for (const range of proseRanges(body)) {
    for (const match of body.slice(range.start, range.end).matchAll(MENTION)) {
      const login = match[1];
      if (login === undefined || allowed.has(login.toLowerCase())) continue;
      const start = range.start + match.index;
      edits.push({ start, end: start + match[0].length, text: `\`${match[0]}\`` });
    }
  }
  const cleaned = applyEdits(body, edits);
  return cleaned.length <= MAX_BODY_CHARS ? cleaned : `${cleaned.slice(0, MAX_BODY_CHARS)}\n\n…(truncated)`;
}

/** Replaces `attachment:<id>` targets with the hosted URLs. Unknown ids were rejected by the Gate. */
export function resolveAttachments(body: string, urls: ReadonlyMap<string, string>): string {
  return body.replace(/attachment:([a-z0-9][a-z0-9-]{0,62})/g, (match, id: string) => urls.get(id) ?? match);
}

/** A loop's state as shown in the cost table. */
export type LoopState = "running" | "completed" | "failed" | "aborted";

const STATE_LABEL: Readonly<Record<LoopState, string>> = {
  running: "⏳ running",
  completed: "✅ done",
  failed: "😕 failed",
  aborted: "⏹️ stopped",
};

export interface CostRow {
  readonly loop: number;
  readonly state: LoopState;
  readonly trigger: string;
  readonly mode: Mode;
  readonly model: string;
  /** null while OpenRouter hasn't reported the final usage yet. */
  readonly costMicros: UsdMicros | null;
  readonly runUrl: string | null;
}

/** The table at the end of the PR body, regenerated from the ledger on every loop. */
export function renderCostTable(rows: readonly CostRow[], routerMicros: UsdMicros, routedComments: number): string {
  const body = rows.map((row) => [
    String(row.loop),
    escapeCell(row.trigger),
    row.mode,
    STATE_LABEL[row.state],
    escapeCell(row.model.replace(/^[^/]+\//, "")),
    row.costMicros === null ? SETTLING : formatUsd(row.costMicros),
    row.runUrl === null ? "" : `[run](${row.runUrl})`,
  ]);
  if (routedComments > 0) {
    body.push(["–", `${String(routedComments)} routed comment${routedComments === 1 ? "" : "s"}`, "router", "", "", formatUsd(routerMicros), ""]);
  }
  const total = rows.reduce((sum, row) => sum + (row.costMicros ?? 0), routerMicros);
  const pending = rows.some((row) => row.costMicros === null);
  const totalText = `${formatUsd(total)}${pending ? ` ${SETTLING}` : ""}`;
  body.push(["**Total**", "", "", "", "", `**${totalText}**`, ""]);
  const table = markdownTable([["Loop", "Trigger", "Mode", "Status", "Model", "Cost", "Run"], ...body], { alignDelimiters: false });
  // Collapsed: the PR description stays about the change; the total is visible in the summary line.
  const loops = `${String(rows.length)} loop${rows.length === 1 ? "" : "s"}`;
  return [COST_START, "<details>", `<summary>macaron-bot cost: <b>${totalText}</b> (${loops})</summary>`, "", table, "", "</details>", COST_END].join("\n");
}

/** Puts `section` (which carries its own markers) in place of the previous one, or appends it. */
export function upsertCostSection(body: string, section: string): string {
  const start = body.indexOf(COST_START);
  const end = body.indexOf(COST_END, start);
  if (start === -1 || end === -1) return `${body.trimEnd()}\n\n${section}\n`;
  return `${body.slice(0, start)}${section}${body.slice(end + COST_END.length)}`;
}

/** markdown-table doesn't escape cell content: a `|` would split the cell. */
function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}
