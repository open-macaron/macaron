import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import * as core from "@actions/core";
import { Attachment, AttachmentId, type LlmAccess, RunContext, RunResult } from "@open-macaron/contracts";
import { judge, localScope } from "@open-macaron/review";
import { z } from "zod";
import { bootstrap as requestBootstrap } from "./controller-api.ts";
import { changesSince, checkout, crlfIntroduced } from "./git.ts";
import { claudeBinary, claudeEnvironment, installHarness, runHarness } from "./harness.ts";
import { type Inputs, type Paths, paths, readInputs } from "./inputs.ts";
import { systemPrompt, taskPrompt } from "./prompts.ts";
import { fetchPullBase } from "./review-diff.ts";

/** What bootstrap hands to the later steps, apart from the key (kept in its own private file). */
const BootstrapState = z.object({
  harness: z.enum(["claude", "codex", "opencode"]),
  model: z.string().min(1),
  baseUrl: z.url(),
  fastModel: z.string().min(1),
});
type BootstrapState = z.infer<typeof BootstrapState>;

async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(file, "utf8")));
}

async function writeJson(file: string, value: unknown, mode = 0o644): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

/** Before any key exists: clone the upstream and install the harness, in parallel. */
export async function prepare(inputs: Inputs = readInputs()): Promise<void> {
  const p = paths(inputs);
  await Promise.all([mkdir(p.state, { recursive: true, mode: 0o700 }), mkdir(p.media, { recursive: true })]);
  const started = Date.now();
  await Promise.all([
    checkout(p.work, inputs.MACARON_REPO, inputs.MACARON_FORK, inputs.MACARON_BRANCH, inputs.MACARON_BASE_SHA),
    mkdir(p.tools, { recursive: true }).then(() => installHarness(inputs.MACARON_HARNESS, p.tools)),
  ]);
  core.info(`prepared in ${String(Math.round((Date.now() - started) / 1000))}s`);
}

/** OIDC token → one-time ticket redemption → key (masked, private file) and context. */
export async function bootstrap(inputs: Inputs = readInputs()): Promise<void> {
  const p = paths(inputs);
  const oidc = await core.getIDToken(inputs.MACARON_CONTROLLER_URL);
  const response = await requestBootstrap(inputs.MACARON_CONTROLLER_URL, { ticket: inputs.MACARON_TICKET }, oidc);
  core.setSecret(response.llm.key);
  await mkdir(p.state, { recursive: true, mode: 0o700 });
  await writeFile(p.keyFile, response.llm.key, { mode: 0o600 });
  await writeJson(p.contextFile, response.context, 0o600);
  const state: BootstrapState = { harness: response.harness, model: response.model, baseUrl: response.llm.baseUrl, fastModel: response.llm.fastModel };
  await writeJson(p.bootstrapFile, state, 0o600);
  core.info(`bootstrapped: ${response.context.mode} on ${response.context.repo}#${String(response.context.number)} with ${response.model}`);
}

/** Runs the agent, then checks its result. */
export async function run(inputs: Inputs = readInputs()): Promise<number> {
  const p = paths(inputs);
  const context = await readJson(p.contextFile, RunContext);
  const state = await readJson(p.bootstrapFile, BootstrapState);
  if (context.mode === "review") return review(inputs, context, state);
  const systemPromptFile = join(p.state, "system-prompt.md");
  const environment = await environmentExtras(p.environment);
  await writeFile(systemPromptFile, [systemPrompt(context, p.out), environment.notes].filter((part) => part !== undefined).join("\n\n"));
  const exitCode = await runHarness({
    harness: state.harness,
    toolsDir: p.tools,
    work: p.work,
    model: state.model,
    llm: await llmAccess(p, state),
    systemPromptFile,
    task: taskPrompt(context),
    mcpConfigFile: environment.mcpConfigFile,
  });
  await rm(p.keyFile, { force: true });
  if (exitCode !== 0) core.warning(`harness exited with ${String(exitCode)}`);
  return finish(inputs);
}

/** The run's LLM endpoint and key, as bootstrap left them. */
async function llmAccess(p: Paths, state: BootstrapState): Promise<LlmAccess> {
  return { baseUrl: state.baseUrl, key: (await readFile(p.keyFile, "utf8")).trim(), fastModel: state.fastModel };
}

/**
 * What the repository's environment prepared for the agent (environments/<name> in open-macaron/runner):
 * MCP servers (`mcp.json`) and instructions (`AGENTS.md`), e.g. a running Podman Desktop to drive.
 */
export async function environmentExtras(dir: string): Promise<{ readonly notes: string | undefined; readonly mcpConfigFile: string | undefined }> {
  const read = async (file: string) => readFile(join(dir, file), "utf8").catch(() => undefined);
  const mcpConfigFile = join(dir, "mcp.json");
  return { notes: (await read("AGENTS.md"))?.trim(), mcpConfigFile: (await read("mcp.json")) === undefined ? undefined : mcpConfigFile };
}

/** Inline diffs beyond this size become a file list: the reviewer reads them with `git diff`. */
const MAX_INLINE_DIFF_CHARS = 150_000;

/**
 * A review: the same engine as a local `macaron-review` (@open-macaron/review): the diff from the
 * merge base, the prompts, the triage and read-only check sessions. The rules are the ones the
 * controller selected on GitHub's diff; it verifies every claimed violation again, and that every
 * rule has a verdict, before publishing anything. This command writes result.json itself (the
 * sessions can't write files).
 */
async function review(inputs: Inputs, context: RunContext, state: BootstrapState): Promise<number> {
  const p = paths(inputs);
  const pull = context.review;
  if (pull === undefined) throw new Error("a review run needs its review context");
  await fetchPullBase(p.work, pull.baseSha);
  const scope = await localScope({ dir: p.work, base: pull.baseSha, mode: "committed", includeUntracked: false });
  const judgement = await judge({
    command: claudeBinary(p.tools),
    cwd: p.work,
    env: claudeEnvironment(await llmAccess(p, state), state.model),
    model: state.model,
    subject: {
      what: `pull request ${context.repo}#${String(context.number)}`,
      title: context.title,
      head: pull.headSha,
      diffCommand: scope.diffCommand,
      request: context.trigger,
      rules: pull.rules,
    },
    annotatedDiff: scope.annotated.length <= MAX_INLINE_DIFF_CHARS ? scope.annotated : undefined,
  });
  await rm(p.keyFile, { force: true });
  if (judgement.verdicts === undefined) {
    core.error(`the review didn't complete: ${judgement.problems.join("; ")}`);
    return 1;
  }
  await writeJson(p.resultFile, {
    action: "review",
    review: judgement.verdicts,
    summary: `Checked ${String(judgement.verdicts.length)} of ${String(pull.rules.length)} rule${pull.rules.length === 1 ? "" : "s"}.`,
    replies: [],
    attachments: [],
    learnings: [],
  });
  return finish(inputs);
}

/** `macaron-agent attach <file> --kind image|video --caption …`: prints the reference to use in text. */
export async function attach(file: string, kind: "image" | "video", caption: string, id: string | undefined, inputs: Inputs = readInputs()): Promise<string> {
  const p = paths(inputs);
  const attachments = await existingAttachments(p);
  const attachmentId = AttachmentId.parse(id ?? `${kind}-${String(attachments.length + 1)}`);
  if ((await stat(file)).size === 0) throw new Error(`${file} is empty`);
  const name = `${attachmentId}${extname(file).toLowerCase()}`;
  await mkdir(p.media, { recursive: true });
  await copyFile(file, join(p.media, name));
  const attachment = Attachment.parse({ id: attachmentId, path: `media/${name}`, kind, caption });
  await writeJson(p.attachmentsFile, [...attachments.filter((existing) => existing.id !== attachmentId), attachment]);
  return `attachment:${attachmentId}`;
}

/** Validates result.json, merges attachments, collects file changes. Exit code 0 only when publishable. */
export async function finish(inputs: Inputs = readInputs()): Promise<number> {
  const p = paths(inputs);
  const context = await readJson(p.contextFile, RunContext);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(p.resultFile, "utf8"));
  } catch {
    core.error(`${p.resultFile} is missing or is not JSON`);
    return 1;
  }
  const attachments = await existingAttachments(p);
  const merged = typeof raw === "object" && raw !== null ? { replies: [], attachments: [], learnings: [], ...raw } : raw;
  const parsed = RunResult.safeParse(merged);
  if (!parsed.success) {
    core.error(`result.json does not match the schema:\n${z.prettifyError(parsed.error)}`);
    return 1;
  }
  const result: RunResult = { ...parsed.data, attachments: mergeAttachments(parsed.data.attachments, attachments) };
  await writeJson(p.resultFile, result);

  const changes = await changesSince(p.work, context.baseSha);
  if (changes.files.length > 0) await writeJson(p.changesFile, changes);
  else await rm(p.changesFile, { force: true });
  const forbidden = changes.files.filter((file) => file.path.startsWith(".github/"));
  if (forbidden.length > 0) {
    core.error(`these files can't be changed by the bot, revert them: ${forbidden.map((file) => file.path).join(", ")}`);
    return 1;
  }
  const crlf = await crlfIntroduced(p.work, changes);
  if (crlf.length > 0) {
    core.error(`these files now have CRLF line endings, convert them back to LF: ${crlf.join(", ")}`);
    return 1;
  }
  core.info(`result ready: ${result.action}, ${String(changes.files.length)} changed file(s), ${String(result.attachments.length)} attachment(s)`);
  return 0;
}

async function existingAttachments(p: Paths): Promise<Attachment[]> {
  try {
    return await readJson(p.attachmentsFile, z.array(Attachment));
  } catch {
    return [];
  }
}

function mergeAttachments(fromResult: readonly Attachment[], recorded: readonly Attachment[]): Attachment[] {
  const byId = new Map(recorded.map((attachment) => [attachment.id, attachment]));
  for (const attachment of fromResult) byId.set(attachment.id, attachment);
  return [...byId.values()];
}
