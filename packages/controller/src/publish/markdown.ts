import type { Mode } from "@open-macaron/contracts";
import { formatUsd, type UsdMicros } from "../common/money.ts";

/** GitHub rejects bodies over 65 536 characters; keep room for our own sections. */
export const MAX_BODY_CHARS = 60_000;

const COST_START = "<!-- macaron:cost:start -->";
const COST_END = "<!-- macaron:cost:end -->";
/** Any HTML comment claiming to be ours; agents must not be able to forge our sections. */
const OUR_MARKERS = /<!--\s*macaron:[\s\S]*?-->/g;
const MENTION = /(^|[^\w`/@])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9_.-]+)?)/g;

/**
 * Makes untrusted text safe to post:
 * - strips anything that looks like our own markers;
 * - turns @mentions of people outside `allowedMentions` into code spans (no notification);
 * - truncates to MAX_BODY_CHARS.
 * Fenced code blocks are left untouched (mentions inside them never notify anyway).
 */
export function sanitize(body: string, allowedMentions: ReadonlySet<string>): string {
  const allowed = new Set([...allowedMentions].map((login) => login.toLowerCase()));
  const cleaned = body
    .replace(OUR_MARKERS, "")
    .split(/(^```[\s\S]*?^```)/m)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(MENTION, (_match, prefix: string, login: string) =>
            allowed.has(login.toLowerCase()) ? `${prefix}@${login}` : `${prefix}\`@${login}\``,
          ),
    )
    .join("");
  return cleaned.length <= MAX_BODY_CHARS ? cleaned : `${cleaned.slice(0, MAX_BODY_CHARS)}\n\n…(truncated)`;
}

/** Replaces `attachment:<id>` targets with the hosted URLs. Unknown ids were rejected by the Gate. */
export function resolveAttachments(body: string, urls: ReadonlyMap<string, string>): string {
  return body.replace(/attachment:([a-z0-9][a-z0-9-]{0,62})/g, (match, id: string) => urls.get(id) ?? match);
}

export interface CostRow {
  readonly loop: number;
  readonly trigger: string;
  readonly mode: Mode;
  readonly model: string;
  readonly costMicros: UsdMicros;
  readonly runUrl: string | null;
}

/** The table at the end of the PR body, regenerated from the ledger on every loop. */
export function renderCostTable(rows: readonly CostRow[], routerMicros: UsdMicros, routedComments: number): string {
  const lines = ["| Loop | Trigger | Mode | Model | Cost | Run |", "|---|---|---|---|---|---|"];
  for (const row of rows) {
    const model = row.model.replace(/^[^/]+\//, "");
    const run = row.runUrl === null ? "" : `[run](${row.runUrl})`;
    lines.push(`| ${String(row.loop)} | ${escapeCell(row.trigger)} | ${row.mode} | ${escapeCell(model)} | ${formatUsd(row.costMicros)} | ${run} |`);
  }
  if (routedComments > 0) {
    lines.push(`| – | ${String(routedComments)} routed comment${routedComments === 1 ? "" : "s"} | router | | ${formatUsd(routerMicros)} | |`);
  }
  const total = rows.reduce((sum, row) => sum + row.costMicros, routerMicros);
  lines.push(`| **Total** | | | | **${formatUsd(total)}** | |`);
  return [COST_START, "### macaron-bot cost", "", ...lines, COST_END].join("\n");
}

/** Puts `section` (which carries its own markers) in place of the previous one, or appends it. */
export function upsertCostSection(body: string, section: string): string {
  const start = body.indexOf(COST_START);
  const end = body.indexOf(COST_END, start);
  if (start === -1 || end === -1) return `${body.trimEnd()}\n\n${section}\n`;
  return `${body.slice(0, start)}${section}${body.slice(end + COST_END.length)}`;
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}
