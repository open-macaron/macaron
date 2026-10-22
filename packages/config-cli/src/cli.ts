#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as core from "@actions/core";
import { CommitSha } from "@open-macaron/contracts";
import { checkOwnerLogins, mergeApproved, type Problem } from "@open-macaron/owners";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import { configLayout } from "./layout.ts";
import { publish } from "./publish.ts";
import { reservedPaths } from "./reserved.ts";
import { loadRepository } from "./tree.ts";

const USAGE = `config-cli <command>

  validate [DIR] [--check-logins]
        check the configuration exactly as the controller does, and each project's OWNERS.yaml
        (DIR defaults to .); --check-logins also asks GitHub that each owner's login matches their id
  build DIR OUT --commit SHA
        write the snapshot GitHub Pages serves (v1/config.json) for the configuration in DIR
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
  return new Octokit({ auth: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_URL, userAgent: "open-macaron/config-cli" });
}

function report(problems: readonly Problem[]): void {
  // @actions/core escapes workflow-command syntax: paths and messages come from untrusted files.
  for (const problem of problems) core.error(problem.message, { file: problem.path, title: "config" });
  if (problems.length === 0) core.info("config: all files are valid");
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "validate": {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: { "check-logins": { type: "boolean", default: false } } });
      const repository = await loadRepository(positionals[0] ?? ".");
      const problems = [...repository.problems, ...(values["check-logins"] ? await checkOwnerLogins(octokit(), repository.folders) : [])];
      report(problems);
      return problems.length === 0 ? 0 : 1;
    }
    case "build": {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: { commit: { type: "string" } } });
      const [dir, out] = positionals;
      const commit = CommitSha.safeParse(values.commit);
      if (dir === undefined || out === undefined || !commit.success) break;
      const repository = await loadRepository(dir);
      if (repository.problems.length > 0) {
        report(repository.problems);
        return 1;
      }
      core.info(`wrote ${await publish(repository.files, commit.data, out)}`);
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
        layout: configLayout,
        statusMarker: "<!-- config-merge-status -->",
        platformPaths: reservedPaths,
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
