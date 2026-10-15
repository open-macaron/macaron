import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Harness } from "@open-macaron/contracts";
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
}

/** Runs the agent to completion in `work`. Resolves with the harness's exit code. */
export function runHarness(run: HarnessRun): Promise<number> {
  switch (run.harness) {
    case "claude":
      return runClaude(run);
    case "codex":
    case "opencode":
      return Promise.reject(new Error(`harness "${run.harness}" is not supported yet`));
  }
}

function runClaude(run: HarnessRun): Promise<number> {
  const args = [
    "--print",
    "--output-format",
    "text",
    "--permission-mode",
    "bypassPermissions",
    "--model",
    run.model,
    "--append-system-prompt-file",
    run.systemPromptFile,
    "--no-session-persistence",
  ];
  const child = spawn(join(run.toolsDir, "node_modules", ".bin", "claude"), args, {
    cwd: run.work,
    stdio: ["pipe", "inherit", "inherit"],
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
  child.stdin.end(run.task);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}
