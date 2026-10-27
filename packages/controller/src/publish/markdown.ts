import type { Mode, Platform, RunKnowledge } from "@open-macaron/contracts";
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
export function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** What a status comment's first line says about a run: mode, platform, run link, the lessons it was given. */
export interface StatusHeader {
  readonly loop: number;
  readonly mode: string;
  readonly platform: Platform;
  readonly runUrl: string | null;
  readonly knowledge: RunKnowledge;
}

/** What a compact answer's footer says about its run: the status header's facts, the runner and the run's id. */
export interface RunFooter extends StatusHeader {
  /** The runner label the run asked for; undefined once the repository no longer enables its platform. */
  readonly runner: string | undefined;
  readonly ghRunId: number | null;
}

const PLATFORM_NAMES: Readonly<Record<Platform, string>> = { linux: "Linux", windows: "Windows", macos: "macOS" };

/** `**macaron-bot** · loop 2 · `reproduce` · Windows · [run](…) · 3 lessons from open-macaron/knowledge@abc1234` */
export function statusHeader(header: StatusHeader): string {
  const parts = [`**macaron-bot**`, `loop ${String(header.loop)}`, `\`${header.mode}\``];
  // Linux is every run's default: only another platform is worth a word.
  if (header.platform !== "linux") parts.push(PLATFORM_NAMES[header.platform]);
  if (header.runUrl !== null) parts.push(`[run](${header.runUrl})`);
  return [...parts, ...lessonsPart(header.knowledge)].join(" · ");
}

/**
 * A compact answer's footer, under a rule and in `<sub>` so it stays out of the way. The spent line
 * stays a line of its own, for withSpentLine once the cost settles.
 */
export function runFooter(footer: RunFooter, where: string, spent: string): string {
  const parts = ["macaron-bot", `loop ${String(footer.loop)}`, `\`${footer.mode}\``];
  // The runner label names the platform already.
  if (footer.runner !== undefined) parts.push(`runner \`${footer.runner}\``);
  if (footer.runUrl !== null) parts.push(`[run${footer.ghRunId === null ? "" : ` ${String(footer.ghRunId)}`}](${footer.runUrl})`);
  return ["---", `<sub>${[...parts, ...lessonsPart(footer.knowledge)].join(" · ")}</sub>`, ...(where === "" ? [] : [where]), spent].join("\n");
}

function lessonsPart({ commit, lessons }: RunKnowledge): string[] {
  if (commit === null || lessons.length === 0) return [];
  const count = `${String(lessons.length)} lesson${lessons.length === 1 ? "" : "s"}`;
  return [`${count} from [open-macaron/knowledge@${commit.slice(0, 7)}](https://github.com/open-macaron/knowledge/tree/${commit})`];
}

/** The status comment's last line: what the thread has cost so far, ⏳ while a loop is still settling. */
export function spentLine(spentMicros: UsdMicros, settling: boolean): string {
  return `<sub>Spent on this thread: ${formatUsd(spentMicros)}${settling ? " ⏳" : ""}.</sub>`;
}

/** A status comment with its spent line replaced (unchanged if it has none, e.g. edited by hand). */
export function withSpentLine(body: string, line: string): string {
  return body.replace(/<sub>Spent on this thread: [^<]*<\/sub>/, line);
}
