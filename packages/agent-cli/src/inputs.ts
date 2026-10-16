import { join } from "node:path";
import { CommitSha, Harness, RepoSlug, Ticket } from "@open-macaron/contracts";
import { z } from "zod";

/**
 * What run.yml hands the CLI (workflow_dispatch inputs and the runner's own variables), parsed
 * once. This module is the only one reading process.env.
 */
const Inputs = z.object({
  MACARON_CONTROLLER_URL: z.url({ protocol: /^https$/ }),
  MACARON_TICKET: Ticket,
  MACARON_REPO: RepoSlug,
  MACARON_FORK: RepoSlug,
  MACARON_BRANCH: z.string().regex(/^macaron\/[0-9]+-[a-z0-9-]{1,48}$/),
  MACARON_BASE_SHA: CommitSha,
  MACARON_HARNESS: Harness,
  RUNNER_TEMP: z.string().min(1),
  GITHUB_WORKSPACE: z.string().min(1),
});
export type Inputs = z.infer<typeof Inputs>;

export function readInputs(): Inputs {
  // eslint-disable-next-line no-restricted-syntax -- the CLI's single configuration entry point
  const parsed = Inputs.safeParse(process.env);
  if (!parsed.success) throw new Error(`invalid inputs:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** The runner's environment, passed through to child processes (PATH, HOME, Actions variables). */
export function inheritedEnvironment(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- children inherit the runner's environment
  return { ...process.env };
}

/** Where everything lives on the runner. The output directory is outside the checkout on purpose. */
export interface Paths {
  /** The upstream checkout the agent works in. */
  readonly work: string;
  /** Private state: key, context. Never uploaded. */
  readonly state: string;
  /** The harness, installed here at prepare time. */
  readonly tools: string;
  readonly keyFile: string;
  readonly contextFile: string;
  readonly bootstrapFile: string;
  /** What the repository's environment leaves for the agent: optional `mcp.json` and `AGENTS.md`. */
  readonly environment: string;
  /** What gets uploaded as the `macaron-result` artifact. */
  readonly out: string;
  readonly media: string;
  readonly resultFile: string;
  readonly changesFile: string;
  readonly attachmentsFile: string;
}

export function paths(inputs: Pick<Inputs, "RUNNER_TEMP" | "GITHUB_WORKSPACE">): Paths {
  const state = join(inputs.RUNNER_TEMP, "macaron");
  const out = join(inputs.RUNNER_TEMP, "macaron-out");
  return {
    work: join(inputs.GITHUB_WORKSPACE, "upstream"),
    state,
    tools: join(inputs.RUNNER_TEMP, "macaron-tools"),
    keyFile: join(state, "openrouter.key"),
    contextFile: join(state, "context.json"),
    bootstrapFile: join(state, "bootstrap.json"),
    environment: join(inputs.RUNNER_TEMP, "macaron-env"),
    out,
    media: join(out, "media"),
    resultFile: join(out, "result.json"),
    changesFile: join(out, "changes.json"),
    attachmentsFile: join(out, "attachments.json"),
  };
}
