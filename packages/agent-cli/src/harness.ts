import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Harness } from "@open-macaron/contracts";
import { z } from "zod";
import { inheritedEnvironment } from "./inputs.ts";

/** Pinned: the newest release that had matured 3 days when it was chosen (same rule as our dependencies). */
const CLAUDE_CODE_VERSION = "2.1.296";
const OPENROUTER_ANTHROPIC_URL = "https://openrouter.ai/api";
/** Claude Code's small background model, also routed through OpenRouter. */
const FAST_MODEL = "anthropic/claude-haiku-5.5";
/**
 * OpenRouter refuses a request (402) when its worst case (max_tokens × output price) exceeds
 * what's left on the key. Claude Code asks for 64 000 by default, which a $0.50 key can't cover.
 */
const MAX_OUTPUT_TOKENS = "16000";

/**
 * Installs the harness into the run's private tools directory, not globally: the repository's
 * environment may switch Node.js versions afterwards, and must not change which harness runs.
 */
export async function installHarness(harness: Harness, toolsDir: string): Promise<void> {
  switch (harness) {
    case "claude":
      await promisify(execFile)("npm", ["install", "--prefix", toolsDir, "--no-fund", "--no-audit", "--no-save", `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`]);
      return;
    case "codex":
    case "opencode":
      throw new Error(`harness "${harness}" is not supported yet`);
  }
}

export interface HarnessRun {
  readonly harness: Harness;
  readonly toolsDir: string;
  readonly work: string;
  readonly model: string;
  readonly openRouterKey: string;
  readonly systemPromptFile: string;
  readonly task: string;
  /**
   * `write`: every tool, no prompts (implement, address_review…). `read-only`: reading, searching,
   * git history and subagents only; anything else is refused by the harness itself.
   */
  readonly access: "write" | "read-only";
  /** JSON Schema of the session's final answer; set: the answer is returned as `output`. */
  readonly outputSchema?: object | undefined;
  /** MCP servers the environment provides (e.g. to drive Podman Desktop). Only write sessions get them. */
  readonly mcpConfigFile?: string | undefined;
}

export interface HarnessOutcome {
  readonly exitCode: number;
  /** The structured final answer when an `outputSchema` was given; undefined otherwise or if absent. */
  readonly output: unknown;
}

/** Runs the agent to completion in `work`. */
export function runHarness(run: HarnessRun): Promise<HarnessOutcome> {
  switch (run.harness) {
    case "claude":
      return runClaude(run);
    case "codex":
    case "opencode":
      return Promise.reject(new Error(`harness "${run.harness}" is not supported yet`));
  }
}

/** Read-only sessions: these built-in tools exist, and Bash may only run these commands. */
const READ_ONLY_TOOLS = "Read,Grep,Glob,Bash,Agent";
const READ_ONLY_BASH = ["Bash(git log *)", "Bash(git blame *)", "Bash(git show *)", "Bash(git diff *)"];

/** Claude Code's command line for a run (exported for tests). */
export function claudeArgs(run: Pick<HarnessRun, "model" | "systemPromptFile" | "access" | "outputSchema" | "mcpConfigFile">): string[] {
  const common = ["--print", "--model", run.model, "--append-system-prompt-file", run.systemPromptFile, "--no-session-persistence"];
  const output = run.outputSchema === undefined ? ["--output-format", "text"] : ["--output-format", "json", "--json-schema", JSON.stringify(run.outputSchema)];
  switch (run.access) {
    case "write": {
      // --strict-mcp-config: only the environment's servers, never a configuration from the checkout.
      const mcp = run.mcpConfigFile === undefined ? [] : ["--mcp-config", run.mcpConfigFile, "--strict-mcp-config"];
      return [...common, ...output, "--permission-mode", "bypassPermissions", ...mcp];
    }
    case "read-only":
      // dontAsk: whatever isn't allowed below is refused, never prompted.
      return [...common, ...output, "--permission-mode", "dontAsk", "--tools", READ_ONLY_TOOLS, "--allowedTools", ...READ_ONLY_BASH];
  }
}

/** The fields we read from `--output-format json`. */
const ClaudeJsonResult = z.object({
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  is_error: z.boolean().optional(),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
});

function runClaude(run: HarnessRun): Promise<HarnessOutcome> {
  const structured = run.outputSchema !== undefined;
  const child = spawn(join(run.toolsDir, "node_modules", ".bin", "claude"), claudeArgs(run), {
    cwd: run.work,
    // With a schema, stdout is the JSON result we parse; otherwise the transcript goes to the log.
    stdio: ["pipe", structured ? "pipe" : "inherit", "inherit"],
    env: {
      ...inheritedEnvironment(),
      // OpenRouter's Anthropic-compatible endpoint, with this run's capped key only.
      ANTHROPIC_BASE_URL: OPENROUTER_ANTHROPIC_URL,
      ANTHROPIC_AUTH_TOKEN: run.openRouterKey,
      ANTHROPIC_API_KEY: "",
      // Every model class maps to an OpenRouter model id.
      ANTHROPIC_DEFAULT_OPUS_MODEL: run.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: run.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: FAST_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL: run.model,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: MAX_OUTPUT_TOKENS,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  if (child.stdin === null) throw new Error("the harness has no stdin to receive the task");
  child.stdin.end(run.task);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output: structured ? structuredOutput(Buffer.concat(chunks).toString("utf8")) : undefined });
    });
  });
}

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
