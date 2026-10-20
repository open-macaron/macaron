import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewVerdicts, type RuleVerdict } from "@open-macaron/contracts";
import { z } from "zod";
import { annotatedFiles } from "./diff.ts";
import {
  reviewSystemPrompt,
  reviewTaskPrompt,
  type ReviewSubject,
  type RuleTriage,
  TriageAnswer,
  triageSchema,
  triageSystemPrompt,
  triageTaskPrompt,
  verdictsSchema,
} from "./prompts.ts";

/**
 * A check session's tools: reading, searching, git history. No subagents: a review's fan-out is
 * decided here (at most MAX_CHECK_SESSIONS), never by the model. Anything else is refused.
 */
const READ_ONLY_TOOLS = "Read,Grep,Glob,Bash";
const READ_ONLY_BASH = ["Bash(git log *)", "Bash(git blame *)", "Bash(git show *)", "Bash(git diff *)"];

/** Check sessions per review, in parallel. A bounded number of requests, whatever the rule count. */
export const MAX_CHECK_SESSIONS = 2;
/** Rules a check session takes before the rules are split; also where triage starts paying for itself. */
export const RULES_PER_SESSION = 8;

/** Claude Code's command line for a check session: read-only (`dontAsk`: what isn't allowed is refused), schema-bound answer. */
export function claudeReviewArgs(options: { readonly model?: string | undefined; readonly systemPromptFile: string }): string[] {
  return [...commonArgs(options, verdictsSchema()), "--tools", READ_ONLY_TOOLS, "--allowedTools", ...READ_ONLY_BASH];
}

/** Claude Code's command line for the triage session: no tools at all, the diff is in the prompt. */
export function claudeTriageArgs(options: { readonly model?: string | undefined; readonly systemPromptFile: string }): string[] {
  return [...commonArgs(options, triageSchema()), "--tools", ""];
}

function commonArgs(options: { readonly model?: string | undefined; readonly systemPromptFile: string }, schema: object): string[] {
  return [
    "--print",
    ...(options.model === undefined ? [] : ["--model", options.model]),
    "--append-system-prompt-file",
    options.systemPromptFile,
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--permission-mode",
    "dontAsk",
  ];
}

export interface JudgeOptions {
  /** The `claude` binary: a path (the runner's tools directory) or a name on PATH (locally). */
  readonly command: string;
  /** The checkout the sessions read. */
  readonly cwd: string;
  /** The sessions' environment; undefined inherits this process's (local use: the user's own login). */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Undefined: the harness's default model. */
  readonly model?: string | undefined;
  readonly subject: ReviewSubject;
  /** Undefined when too large: no triage, and the prompts say how to read it. */
  readonly annotatedDiff: string | undefined;
}

export interface JudgeSession {
  readonly phase: "triage" | "check";
  readonly rules: number;
  readonly exitCode: number;
  readonly turns: number | undefined;
  /** As the harness reports it; the key's budget is what counts. */
  readonly costUsd: number | undefined;
  /** Whether it gave a valid structured answer. */
  readonly answered: boolean;
}

export interface Judgement {
  /** One verdict per rule given, or undefined: a review never comes back partial. */
  readonly verdicts: readonly RuleVerdict[] | undefined;
  /** Why the verdicts are missing. */
  readonly problems: readonly string[];
  readonly sessions: readonly JudgeSession[];
}

type Rules = ReviewSubject["rules"];

/**
 * A review in fixed phases, the same for the bot's run and for a local review:
 * 1. triage (more than RULES_PER_SESSION rules, diff inlined): one session without tools drops the
 *    rules the change can't concern;
 * 2. the remaining rules, split into at most MAX_CHECK_SESSIONS groups, each checked by its own
 *    read-only session on the diff of its files;
 * 3. completeness, in code: the rules still without a verdict get one more session; if some are
 *    still missing, the review fails.
 */
export async function judge(options: JudgeOptions): Promise<Judgement> {
  const dir = await mkdtemp(join(tmpdir(), "macaron-review-"));
  const sessions: JudgeSession[] = [];
  let count = 0;
  /** One harness session; its answer, or undefined. */
  const session = async <T>(phase: JudgeSession["phase"], rules: Rules, args: (systemPromptFile: string) => string[], systemPrompt: string, task: string, answer: z.ZodType<T>): Promise<T | undefined> => {
    const systemPromptFile = join(dir, `system-prompt-${String(++count)}.md`);
    await writeFile(systemPromptFile, systemPrompt);
    const { exitCode, stdout } = await run(options.command, args(systemPromptFile), options.cwd, options.env, task);
    const { output, turns, costUsd, isError } = harnessResult(stdout);
    const parsed = answer.safeParse(output);
    sessions.push({ phase, rules: rules.length, exitCode, turns, costUsd, answered: parsed.success });
    const why = parsed.success ? "" : `, no valid answer: ${output === undefined ? "no structured output" : z.prettifyError(parsed.error)}`;
    process.stderr.write(`harness ${phase} (${String(rules.length)} rules): ${String(turns ?? "?")} turns, reported cost $${String(costUsd ?? "?")}${isError ? ", ended with an error" : ""}${why}\n`);
    return parsed.success ? parsed.data : undefined;
  };
  const check = async (rules: Rules): Promise<RuleVerdict[]> => {
    const subject = { ...options.subject, rules };
    const diff = options.annotatedDiff === undefined ? undefined : annotatedFiles(options.annotatedDiff, [...new Set(rules.flatMap(({ files }) => files))]);
    const args = (systemPromptFile: string) => claudeReviewArgs({ model: options.model, systemPromptFile });
    const answer = await session("check", rules, args, reviewSystemPrompt(subject), reviewTaskPrompt(subject, diff), ReviewVerdicts);
    return answer?.verdicts ?? [];
  };

  try {
    const rules = options.subject.rules;
    let triaged: RuleVerdict[] = [];
    if (options.annotatedDiff !== undefined && rules.length > RULES_PER_SESSION) {
      const args = (systemPromptFile: string) => claudeTriageArgs({ model: options.model, systemPromptFile });
      const answer = await session("triage", rules, args, triageSystemPrompt(options.subject), triageTaskPrompt(options.subject, options.annotatedDiff), TriageAnswer);
      triaged = notApplicable(rules, answer?.rules ?? []);
    }
    const dropped = new Set(triaged.map((verdict) => verdict.ruleId));
    const checked = await Promise.all(partitionRules(rules.filter(({ rule }) => !dropped.has(rule.id))).map(check));
    let verdicts = mergeVerdicts(rules, [triaged, ...checked]);

    const missing = new Set(missingRules(rules, verdicts));
    if (missing.size > 0) verdicts = mergeVerdicts(rules, [verdicts, await check(rules.filter(({ rule }) => missing.has(rule.id)))]);
    const left = missingRules(rules, verdicts);
    if (left.length > 0) return { verdicts: undefined, problems: [`the review left rules unchecked: ${left.join(", ")}`], sessions };
    return { verdicts, problems: [], sessions };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Triage's `applies: false`, as verdicts. A rule triage didn't answer for (or answered twice) is checked. */
function notApplicable(rules: Rules, triage: readonly RuleTriage[]): RuleVerdict[] {
  return rules.flatMap(({ rule }): RuleVerdict[] => {
    const entries = triage.filter((entry) => entry.ruleId === rule.id);
    const [entry] = entries;
    return entries.length === 1 && entry?.applies === false ? [{ ruleId: rule.id, verdict: "not_applicable", evidence: [], explanation: entry.reason }] : [];
  });
}

/**
 * The rules to check, in at most MAX_CHECK_SESSIONS groups: one up to RULES_PER_SESSION, else two
 * halves, rules on the same files kept next to each other so a session reads fewer files.
 */
export function partitionRules<T extends { readonly files: readonly string[] }>(rules: readonly T[]): T[][] {
  if (rules.length === 0) return [];
  if (rules.length <= RULES_PER_SESSION) return [[...rules]];
  const sorted = [...rules].sort((a, b) => a.files.join("\n").localeCompare(b.files.join("\n")));
  const size = Math.ceil(sorted.length / MAX_CHECK_SESSIONS);
  return Array.from({ length: MAX_CHECK_SESSIONS }, (_, index) => sorted.slice(index * size, (index + 1) * size)).filter((group) => group.length > 0);
}

/** One verdict per rule, in the rules' order: the first source that has one wins; ids not asked are dropped. */
export function mergeVerdicts(rules: readonly { readonly rule: { readonly id: string } }[], sources: readonly (readonly RuleVerdict[])[]): RuleVerdict[] {
  const found = new Map<string, RuleVerdict>();
  for (const verdict of sources.flat()) if (!found.has(verdict.ruleId)) found.set(verdict.ruleId, verdict);
  return rules.flatMap(({ rule }) => {
    const verdict = found.get(rule.id);
    return verdict === undefined ? [] : [verdict];
  });
}

/** The ids of the rules without a verdict. The judge retries them once; the Gate refuses a review that has any. */
export function missingRules(rules: readonly { readonly rule: { readonly id: string } }[], verdicts: readonly RuleVerdict[]): string[] {
  const answered = new Set(verdicts.map((verdict) => verdict.ruleId));
  return rules.map(({ rule }) => rule.id).filter((id) => !answered.has(id));
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv | undefined, input: string): Promise<{ exitCode: number; stdout: string }> {
  const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "inherit"], ...(env === undefined ? {} : { env }) });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** The fields read from Claude Code's `--output-format json`. */
const ClaudeJsonResult = z.object({
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  is_error: z.boolean().optional(),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
});

/** Claude Code's JSON result: the answer (see `structuredOutput`) and what the session reported. */
function harnessResult(stdout: string): { output: unknown; turns: number | undefined; costUsd: number | undefined; isError: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { output: undefined, turns: undefined, costUsd: undefined, isError: true };
  }
  const result = ClaudeJsonResult.safeParse(parsed);
  if (!result.success) return { output: undefined, turns: undefined, costUsd: undefined, isError: true };
  const { structured_output: output, result: text, num_turns: turns, total_cost_usd: costUsd, is_error: isError } = result.data;
  return { output: output ?? jsonText(text), turns, costUsd, isError: isError === true };
}

/** The schema-validated answer from Claude Code's JSON result, falling back to its final text if it is JSON. */
export function structuredOutput(stdout: string): unknown {
  return harnessResult(stdout).output;
}

function jsonText(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
