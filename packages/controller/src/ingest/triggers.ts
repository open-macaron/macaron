import slugify from "@sindresorhus/slugify";
import type { Mode } from "@open-macaron/contracts";
import { proseRanges } from "../publish/markdown-ast.ts";

export interface Subject {
  readonly repo: string;
  readonly number: number;
  readonly kind: "issue" | "pull";
}

/** `https://api.github.com/repos/{owner}/{repo}/(issues|pulls)/{n}` → subject. */
export function parseSubjectUrl(url: string | null): Subject | undefined {
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(issues|pulls)\/(\d+)$/.exec(url ?? "");
  if (match === null) return undefined;
  const [, repo, type, number] = match;
  if (repo === undefined || type === undefined || number === undefined) return undefined;
  return { repo, number: Number(number), kind: type === "pulls" ? "pull" : "issue" };
}

export type Command = Mode | "stop";

const COMMANDS: ReadonlySet<string> = new Set<Command>(["plan", "implement", "reproduce", "verify", "triage", "stop"]);
/** Natural phrasings mapped to commands, e.g. "@macaron-bot can you reproduce?". */
const ALIASES: readonly (readonly [RegExp, Command])[] = [
  [/\breproduc(e|ing)\b/i, "reproduce"],
  [/\bverify\b|\btry (the|this) fix\b/i, "verify"],
  [/\bplan\b/i, "plan"],
  [/\b(implement|fix it|go ahead)\b/i, "implement"],
  [/\bstop\b|\bcancel\b/i, "stop"],
];

export interface Mention {
  /** Explicit command, if the mention carries one; otherwise the Router (triage) decides. */
  readonly command: Command | undefined;
  /** The comment text addressed to the bot, for the agent's context. */
  readonly instruction: string;
}

/**
 * Finds a mention of `login` in prose (never in code, quotes or links' URLs, thanks to a real
 * Markdown parser). `@macaron-bot implement` and `@macaron-bot can you reproduce?` both yield a
 * command; a bare mention yields none. The instruction is the rest of the mention's line.
 */
export function parseMention(body: string, login: string): Mention | undefined {
  const mention = new RegExp(`(?<![\\w@/-])@${RegExp.escape(login)}(?![\\w-])`, "i");
  for (const range of proseRanges(body, { skipQuotes: true })) {
    const match = mention.exec(body.slice(range.start, range.end));
    if (match === null) continue;
    const after = range.start + match.index + match[0].length;
    const lineEnd = body.indexOf("\n", after);
    const rest = body.slice(after, lineEnd === -1 ? undefined : lineEnd).trim();
    const first = rest.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z_]/g, "") ?? "";
    if (isCommand(first)) return { command: first, instruction: rest };
    return { command: ALIASES.find(([regex]) => regex.test(rest))?.[1], instruction: rest };
  }
  return undefined;
}

function isCommand(value: string): value is Command {
  return COMMANDS.has(value);
}

/** `macaron/<number>-<slug>` from an issue title (slug by @sindresorhus/slugify, at most 40 chars). */
export function branchFor(number: number, title: string): string {
  const slug = slugify(title).slice(0, 40).replace(/-+$/, "");
  return `macaron/${String(number)}-${slug === "" ? "work" : slug}`;
}

export interface TriggerEvent {
  readonly kind: "mention" | "review" | "comment";
  readonly command: Command | undefined;
}

/**
 * The mode for a batch of coalesced events on one thread:
 * an explicit command wins (the latest one), otherwise inline review comments mean
 * address_review, otherwise a cheap triage run decides.
 */
export function decideMode(events: readonly TriggerEvent[]): Command | undefined {
  if (events.length === 0) return undefined;
  const explicit = events.filter((event) => event.command !== undefined).at(-1)?.command;
  if (explicit !== undefined) return explicit;
  if (events.some((event) => event.kind === "review")) return "address_review";
  return "triage";
}
