#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as core from "@actions/core";
import { attach, bootstrap, finish, prepare, run } from "./commands.ts";

const USAGE = `macaron-agent <command>

  prepare      clone the upstream and install the harness (before any key exists)
  bootstrap    exchange the runner's OIDC token for this run's key and context
  run          run the agent, then check its result
  attach FILE --kind image|video --caption TEXT [--id ID]
               add a screenshot or video; prints the reference to use in text
  finish       check result.json and collect file changes
`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "prepare":
      await prepare();
      return 0;
    case "bootstrap":
      await bootstrap();
      return 0;
    case "run":
      return run();
    case "finish":
      return finish();
    case "attach": {
      const { values, positionals } = parseArgs({
        args: [...rest],
        allowPositionals: true,
        options: { kind: { type: "string" }, caption: { type: "string" }, id: { type: "string" } },
      });
      const [file] = positionals;
      const kind = values.kind;
      if (file === undefined || (kind !== "image" && kind !== "video") || values.caption === undefined) {
        process.stderr.write(USAGE);
        return 2;
      }
      process.stdout.write(`${await attach(file, kind, values.caption, values.id)}\n`);
      return 0;
    }
    case undefined:
    default:
      process.stderr.write(USAGE);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error: unknown) {
  core.error(error instanceof Error ? error.message : "unexpected error");
  process.exitCode = 1;
}
