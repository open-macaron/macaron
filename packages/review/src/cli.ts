import { parseArgs } from "node:util";
import { selectRules } from "./select.ts";
import { judge } from "./judge.ts";
import { DEFAULT_KNOWLEDGE_URL, KnowledgeSource } from "./knowledge.ts";
import { reviewSystemPrompt, reviewTaskPrompt, type ReviewSubject } from "./prompts.ts";
import { countResults, renderText, sortResults } from "./render.ts";
import { isWorktree, localScope, type ScopeMode } from "./scope.ts";
import { verifyReview } from "./verify.ts";

export const USAGE = `macaron-review: check your changes against the open-macaron/knowledge rules, as @macaron-bot review does.

Usage:
  macaron-review [review] [options]   review the changes with your local agent
  macaron-review rules [options]      list the rules that apply to the changes (no agent)

Options:
  --project P            project rules (global → P → repository), e.g. podman-desktop-extensions
  --repo OWNER/NAME      repository rules (default: the upstream remote, else origin)
  --base BRANCH          compare to BRANCH, from the merge base (default: the remote's default branch)
  --committed            only committed changes
  --uncommitted          only staged and unstaged changes
  --include-untracked    also files not added to git yet
  --agent                one JSON object per line (for agents and scripts)
  --harness claude       the local agent that judges (only claude for now)
  --model M              the harness's model (default: its own)
  --show-prompts         print the prompts instead of running the review
  --dir PATH             the git worktree to review (default: the current directory)
  --all                  rules: every rule of the project, whatever changed
  --knowledge-url URL    the knowledge read API (default: ${DEFAULT_KNOWLEDGE_URL})

Exit codes: 0 no violation, 1 at least one violation of an error rule, 2 the review couldn't run.
`;

/** Diffs beyond this size aren't inlined: the prompt says how to read them file by file. */
const MAX_INLINE_DIFF_CHARS = 150_000;

export class UsageError extends Error {}

/** `claude`: the harness binary (tests point it at a fake). */
export async function main(argv: readonly string[], dependencies: { readonly claude: string } = { claude: "claude" }): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      project: { type: "string" },
      repo: { type: "string" },
      base: { type: "string" },
      committed: { type: "boolean", default: false },
      uncommitted: { type: "boolean", default: false },
      "include-untracked": { type: "boolean", default: false },
      agent: { type: "boolean", default: false },
      harness: { type: "string", default: "claude" },
      model: { type: "string" },
      "show-prompts": { type: "boolean", default: false },
      dir: { type: "string", default: "." },
      all: { type: "boolean", default: false },
      "knowledge-url": { type: "string", default: DEFAULT_KNOWLEDGE_URL },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command = "review", ...extra] = positionals;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (extra.length > 0 || (command !== "review" && command !== "rules")) throw new UsageError(`unknown command: ${positionals.join(" ")}`);
  if (values.committed && values.uncommitted) throw new UsageError("--committed and --uncommitted can't be combined");
  if (values.harness !== "claude") throw new UsageError(`harness "${values.harness}" isn't supported yet (only claude)`);
  if (!(await isWorktree(values.dir))) throw new UsageError(`${values.dir} isn't inside a git worktree`);

  const mode: ScopeMode = values.committed ? "committed" : values.uncommitted ? "uncommitted" : "all";
  const scope = await localScope({ dir: values.dir, base: values.base, mode, includeUntracked: values["include-untracked"] });
  const repo = values.repo ?? scope.repo;
  const knowledge = await new KnowledgeSource(values["knowledge-url"]).rules({ project: values.project, repo });
  const selection = selectRules(knowledge.rules, scope.files.map((file) => file.path));
  const context = {
    type: "context",
    repo: repo ?? null,
    project: values.project ?? null,
    base: scope.base,
    mergeBase: scope.mergeBase,
    knowledgeCommit: knowledge.commit,
    rules: selection.rules.length,
    skipped: selection.skipped.length,
    files: scope.files.length,
  };
  const emit = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`);

  if (command === "rules") {
    const rules = values.all ? knowledge.rules.map((rule) => ({ rule, files: [] })) : selection.rules;
    if (values.agent) {
      emit(context);
      for (const { rule, files } of rules) emit({ type: "rule", id: rule.id, severity: rule.severity, title: rule.title, files });
      if (!values.all) for (const skipped of selection.skipped) emit({ type: "skipped", id: skipped.id, severity: skipped.severity, title: skipped.title, reason: skipped.reason });
    } else {
      for (const { rule, files } of rules) process.stdout.write(`${rule.severity.padEnd(7)}  ${rule.id}\n         ${rule.title}${files.length > 0 ? `\n         ${files.join(", ")}` : ""}\n`);
      if (!values.all && selection.skipped.length > 0) process.stdout.write(`\nNot applicable to these changes: ${selection.skipped.map((skipped) => skipped.id).join(", ")}\n`);
      if (rules.length === 0) process.stdout.write("No rule applies.\n");
    }
    return 0;
  }

  if (selection.rules.length === 0) {
    if (values.agent) {
      emit(context);
      emit({ type: "complete", status: "review_skipped", reason: scope.files.length === 0 ? "nothing changed" : "no rule applies to the changed files" });
    } else {
      process.stdout.write(scope.files.length === 0 ? "Nothing changed.\n" : "No rule applies to the changed files.\n");
    }
    return 0;
  }

  const subject: ReviewSubject = {
    what: `the local changes of ${repo ?? "this repository"} (compared to ${scope.base})`,
    head: scope.head,
    diffCommand: scope.diffCommand,
    rules: selection.rules,
  };
  const annotatedDiff = scope.annotated.length <= MAX_INLINE_DIFF_CHARS ? scope.annotated : undefined;
  if (values["show-prompts"]) {
    process.stdout.write(`${reviewSystemPrompt(subject)}\n---\n\n${reviewTaskPrompt(subject, annotatedDiff)}`);
    return 0;
  }

  if (values.agent) emit(context);
  const judgement = await judge({ command: dependencies.claude, cwd: scope.root, model: values.model, subject, annotatedDiff });
  if (judgement.verdicts === undefined) throw new Error(`the review didn't complete: ${judgement.problem ?? `claude exited with ${String(judgement.exitCode)}`}`);
  const verification = verifyReview(selection, judgement.verdicts, scope);
  const counts = countResults(verification.results);

  if (values.agent) {
    for (const result of sortResults(verification.results)) {
      emit({ type: "rule", id: result.id, severity: result.severity, result: result.outcome, evidence: result.evidence, explanation: result.explanation ?? result.reason ?? null });
    }
    emit({ type: "complete", status: "done", counts, problems: verification.problems, model: values.model ?? null });
  } else {
    process.stdout.write(`${renderText(verification.results, { knowledgeCommit: knowledge.commit })}\n`);
  }
  return counts.violation > 0 ? 1 : 0;
}
