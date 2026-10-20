import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Harness, LlmAccess } from "@open-macaron/contracts";
import { inheritedEnvironment } from "./inputs.ts";

/** Pinned: the newest release that had matured 3 days when it was chosen (same rule as our dependencies). */
const CLAUDE_CODE_VERSION = "2.1.296";
/**
 * OpenRouter refuses a request (402) when its worst case (max_tokens × output price) exceeds
 * what's left on the key. Claude Code asks for 64 000 by default, which a $0.50 key can't cover.
 * Bifrost charges after the request instead, so this also bounds how far one request overshoots.
 */
const MAX_OUTPUT_TOKENS = "16000";

/**
 * Installs the harness into the run's private tools directory, not globally: the repository's
 * environment may switch Node.js versions afterwards, and must not change which harness runs.
 */
export async function installHarness(harness: Harness, toolsDir: string): Promise<void> {
  switch (harness) {
    case "claude":
      // On Windows npm is a .cmd script, which Node only starts through a shell. The arguments are constants.
      await promisify(execFile)("npm", ["install", "--prefix", toolsDir, "--no-fund", "--no-audit", "--no-save", `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`], {
        shell: process.platform === "win32",
      });
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
  readonly llm: LlmAccess;
  readonly systemPromptFile: string;
  readonly task: string;
  /** MCP servers the environment provides (e.g. to drive Podman Desktop). */
  readonly mcpConfigFile?: string | undefined;
}

/**
 * Runs a write session (implement, address_review…: every tool, no prompts) to completion in `work`.
 * Reviews run read-only through @open-macaron/review's `judge`, with `claudeBinary` and `claudeEnvironment`.
 */
export function runHarness(run: HarnessRun): Promise<number> {
  switch (run.harness) {
    case "claude":
      return runClaude(run);
    case "codex":
    case "opencode":
      return Promise.reject(new Error(`harness "${run.harness}" is not supported yet`));
  }
}

/** Claude Code's command line for a write session (exported for tests). */
export function claudeArgs(run: Pick<HarnessRun, "model" | "systemPromptFile" | "mcpConfigFile">): string[] {
  // --strict-mcp-config: only the environment's servers, never a configuration from the checkout.
  const mcp = run.mcpConfigFile === undefined ? [] : ["--mcp-config", run.mcpConfigFile, "--strict-mcp-config"];
  return [
    "--print",
    "--model",
    run.model,
    "--append-system-prompt-file",
    run.systemPromptFile,
    "--no-session-persistence",
    "--output-format",
    "text",
    "--permission-mode",
    "bypassPermissions",
    ...mcp,
  ];
}

/**
 * The harness installed by `prepare`: the package's native executable, named `claude.exe` on every
 * platform. Not `.bin/claude`, a `.cmd` shim on Windows that Node can't spawn without a shell.
 */
export function claudeBinary(toolsDir: string): string {
  return join(toolsDir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
}

/** Every session's environment: the run's Anthropic-compatible endpoint, with this run's capped key only. */
export function claudeEnvironment(llm: LlmAccess, model: string): NodeJS.ProcessEnv {
  return {
    ...inheritedEnvironment(),
    ANTHROPIC_BASE_URL: llm.baseUrl,
    ANTHROPIC_AUTH_TOKEN: llm.key,
    ANTHROPIC_API_KEY: "",
    // Every model class maps to a model the run's key allows.
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: llm.fastModel,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: MAX_OUTPUT_TOKENS,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

function runClaude(run: HarnessRun): Promise<number> {
  const child = spawn(claudeBinary(run.toolsDir), claudeArgs(run), {
    cwd: run.work,
    stdio: ["pipe", "inherit", "inherit"],
    env: claudeEnvironment(run.llm, run.model),
  });
  child.stdin.end(run.task);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}
