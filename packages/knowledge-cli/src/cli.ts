#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as core from "@actions/core";
import { CommitSha } from "@open-macaron/contracts";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import { checkOwnerLogins, mergeApproved } from "@open-macaron/owners";
import { knowledgeLayout } from "./layout.ts";
import { publish } from "./publish.ts";
import { loadTree, type Problem } from "./tree.ts";

const USAGE = `knowledge-cli <command>

  validate [DIR] [--check-logins]
        check the layout, OWNERS.yaml files, rules and lessons (DIR defaults to .);
        --check-logins also asks GitHub that each owner's login matches their id
  build DIR OUT --commit SHA
        write the GitHub Pages read API (v1/*.json) for the tree in DIR
  merge --head-sha SHA --format-valid true|false
        evaluate and merge owner-approved PRs at SHA (merge.yml; needs GITHUB_TOKEN)
`;

/** The Actions environment, read once. */
const ActionsEnv = z.object({
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_REPOSITORY: z.string().regex(/^[^/]+\/[^/]+$/).optional(),
  GITHUB_SERVER_URL: z.url().default("https://github.com"),
  GITHUB_RUN_ID: z.string().optional(),
  GITHUB_API_URL: z.url().default("https://api.github.com"),
});
// eslint-disable-next-line no-restricted-syntax -- the CLI's single configuration entry point
const env = ActionsEnv.parse(process.env);

function octokit(): Octokit {
  return new Octokit({ auth: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_URL, userAgent: "open-macaron/knowledge-cli" });
}

function report(problems: readonly Problem[]): void {
  // @actions/core escapes workflow-command syntax: paths and messages come from untrusted files.
  for (const problem of problems) core.error(problem.message, { file: problem.path, title: "knowledge" });
  if (problems.length === 0) core.info("knowledge: all files are valid");
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "validate": {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: { "check-logins": { type: "boolean", default: false } } });
      const tree = await loadTree(positionals[0] ?? ".");
      const problems = [...tree.problems, ...(values["check-logins"] ? await checkOwnerLogins(octokit(), tree.folders) : [])];
      report(problems);
      return problems.length === 0 ? 0 : 1;
    }
    case "build": {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: { commit: { type: "string" } } });
      const [dir, out] = positionals;
      const commit = CommitSha.safeParse(values.commit);
      if (dir === undefined || out === undefined || !commit.success) break;
      const tree = await loadTree(dir);
      if (tree.problems.length > 0) {
        report(tree.problems);
        return 1;
      }
      for (const path of await publish(tree, commit.data, out)) core.info(`wrote ${path}`);
      return 0;
    }
    case "merge": {
      const { values } = parseArgs({ args: [...rest], options: { "head-sha": { type: "string" }, "format-valid": { type: "string" } } });
      const headSha = CommitSha.safeParse(values["head-sha"]);
      const formatValid = values["format-valid"];
      if (!headSha.success || (formatValid !== "true" && formatValid !== "false") || env.GITHUB_REPOSITORY === undefined || env.GITHUB_TOKEN === undefined) break;
      const [owner = "", repo = ""] = env.GITHUB_REPOSITORY.split("/");
      const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
      const merged = await mergeApproved(octokit(), { owner, repo }, headSha.data, formatValid === "true", runUrl, {
        layout: knowledgeLayout,
        // Unchanged since before the code was shared: existing status comments keep being updated.
        statusMarker: "<!-- knowledge-merge-status -->",
      });
      core.setOutput("merged", merged.length > 0 ? "true" : "false");
      core.info(merged.length === 0 ? "nothing merged" : `merged #${merged.join(", #")}`);
      return 0;
    }
    case undefined:
    default:
      break;
  }
  process.stderr.write(USAGE);
  return 2;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error: unknown) {
  core.setFailed(error instanceof Error ? error.message : String(error));
}
