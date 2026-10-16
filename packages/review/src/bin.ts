#!/usr/bin/env node
import { main, USAGE, UsageError } from "./cli.ts";

// A reader that stops early (`| head`) closes the pipe: stop quietly, as git does.
process.stdout.on("error", (error: unknown) => {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE") process.exit(0);
  throw error;
});

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`macaron-review: ${message}\n${error instanceof UsageError ? `\n${USAGE}` : ""}`);
  process.exitCode = 2;
}
