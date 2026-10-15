import type { Mode } from "@open-macaron/contracts";

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
 * Finds a mention of `login` outside code and quotes. `@macaron-bot implement` and
 * `@macaron-bot can you reproduce?` both yield a command; a bare mention yields none.
 */
export function parseMention(body: string, login: string): Mention | undefined {
  const prose = body
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/`[^`\n]*`/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  const pattern = new RegExp(`(^|[^\\w@/-])@${login.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&")}(?![\\w-])([^\\n]*)`, "i");
  const match = pattern.exec(prose);
  if (match === null) return undefined;
  const rest = (match[2] ?? "").trim();
  const first = rest.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z_]/g, "") ?? "";
  if (isCommand(first)) return { command: first, instruction: rest };
  const alias = ALIASES.find(([regex]) => regex.test(rest));
  return { command: alias?.[1], instruction: rest };
}

function isCommand(value: string): value is Command {
  return COMMANDS.has(value);
}

/** `macaron/<number>-<slug>` from an issue title: lowercase, ascii, at most 40 chars of slug. */
export function branchFor(number: number, title: string): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "work";
  return `macaron/${String(number)}-${slug}`;
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
