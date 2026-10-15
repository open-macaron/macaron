import type { AppEnv } from "../config/env.ts";

/** Public URL of a workflow run in the runner repository. */
export function runUrl(env: AppEnv, ghRunId: number | null): string | null {
  return ghRunId === null ? null : `https://github.com/${env.RUNNER_REPO}/actions/runs/${String(ghRunId)}`;
}
