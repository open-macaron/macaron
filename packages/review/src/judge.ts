import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewVerdicts, type RuleVerdict } from "@open-macaron/contracts";
import { z } from "zod";
import { reviewSystemPrompt, reviewTaskPrompt, type ReviewSubject, verdictsSchema } from "./prompts.ts";

/** The review session's tools: reading, searching, git history, subagents. Anything else is refused. */
const READ_ONLY_TOOLS = "Read,Grep,Glob,Bash,Agent";
const READ_ONLY_BASH = ["Bash(git log *)", "Bash(git blame *)", "Bash(git show *)", "Bash(git diff *)"];

/** Claude Code's command line for a review: read-only (`dontAsk`: what isn't allowed is refused), schema-bound answer. */
export function claudeReviewArgs(options: { readonly model?: string | undefined; readonly systemPromptFile: string }): string[] {
  return [
    "--print",
    ...(options.model === undefined ? [] : ["--model", options.model]),
    "--append-system-prompt-file",
    options.systemPromptFile,
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(verdictsSchema()),
    "--permission-mode",
    "dontAsk",
    "--tools",
    READ_ONLY_TOOLS,
    "--allowedTools",
    ...READ_ONLY_BASH,
  ];
}

export interface JudgeOptions {
  /** The `claude` binary: a path (the runner's tools directory) or a name on PATH (locally). */
  readonly command: string;
  /** The checkout the session reads. */
  readonly cwd: string;
  /** The session's environment; undefined inherits this process's (local use: the user's own login). */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Undefined: the harness's default model. */
  readonly model?: string | undefined;
  readonly subject: ReviewSubject;
  /** Undefined when too large: the prompt then says how to read it. */
  readonly annotatedDiff: string | undefined;
}

export interface Judgement {
  readonly exitCode: number;
  /** Undefined when the session gave no valid answer. */
  readonly verdicts: readonly RuleVerdict[] | undefined;
  /** Why the answer is missing or invalid, for the caller's error message. */
  readonly problem: string | undefined;
}

/** One read-only harness session over every selected rule. The same for the bot's run and for a local review. */
export async function judge(options: JudgeOptions): Promise<Judgement> {
  const dir = await mkdtemp(join(tmpdir(), "macaron-review-"));
  try {
    const systemPromptFile = join(dir, "system-prompt.md");
    await writeFile(systemPromptFile, reviewSystemPrompt(options.subject));
    const { exitCode, stdout } = await run(options.command, claudeReviewArgs({ model: options.model, systemPromptFile }), options.cwd, options.env, reviewTaskPrompt(options.subject, options.annotatedDiff));
    const output = structuredOutput(stdout);
    const verdicts = ReviewVerdicts.safeParse(output);
    if (verdicts.success) return { exitCode, verdicts: verdicts.data.verdicts, problem: undefined };
    return { exitCode, verdicts: undefined, problem: output === undefined ? "the reviewer gave no structured answer" : z.prettifyError(verdicts.error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

/** The schema-validated answer from Claude Code's JSON result, falling back to its final text if it is JSON. */
export function structuredOutput(stdout: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const result = ClaudeJsonResult.safeParse(parsed);
  if (!result.success) return undefined;
  const { structured_output: output, result: text, num_turns: turns, total_cost_usd: cost } = result.data;
  process.stderr.write(`harness: ${String(turns ?? "?")} turns, reported cost $${String(cost ?? "?")}${result.data.is_error === true ? ", ended with an error" : ""}\n`);
  if (output !== undefined) return output;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
